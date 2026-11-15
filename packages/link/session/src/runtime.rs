use std::future::Future;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use tokio::runtime::{Builder, Handle};
use tokio::sync::oneshot;

use crate::error::Error;

/// The runtime every session of the app runs on: one current-thread tokio runtime on one
/// dedicated thread.
///
/// A phone holds a handful of sessions whose work is socket I/O and a few microseconds of AEAD per
/// frame, so one thread keeps up, and it parks in the kernel whenever no socket or timer is due —
/// no work stealing wakes a second core for a frame. Foreign callers (Swift, Kotlin) never run
/// tokio themselves: every async entry point hands its work to this thread and awaits the result,
/// which UniFFI can poll from any executor.
#[derive(Clone)]
pub struct LinkRuntime {
    inner: Arc<Inner>,
}

struct Inner {
    handle: Handle,
    stop: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl LinkRuntime {
    pub fn new() -> std::io::Result<LinkRuntime> {
        let runtime = Builder::new_current_thread().enable_all().build()?;
        let handle = runtime.handle().clone();
        let (stop, stopped) = oneshot::channel::<()>();
        let thread = thread::Builder::new()
            .name("broski-link".to_owned())
            .spawn(move || {
                runtime.block_on(async {
                    let _ = stopped.await;
                });
            })?;
        Ok(LinkRuntime {
            inner: Arc::new(Inner {
                handle,
                stop: Some(stop),
                thread: Some(thread),
            }),
        })
    }

    /// Runs `future` on the runtime thread and waits for it from whatever executor the caller is on.
    pub(crate) async fn run<F>(&self, future: F) -> Result<F::Output, Error>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.inner
            .handle
            .spawn(future)
            .await
            .map_err(|_| Error::RuntimeStopped)
    }

    /// The runtime thread, for a crate that runs its own tasks beside the sessions'. Anything it
    /// spawns must not block: one thread carries every session of the app.
    pub fn handle(&self) -> &Handle {
        &self.inner.handle
    }
}

impl Drop for Inner {
    /// Stops the thread, which drops every task still on it and with them their sockets. The join
    /// is skipped when the last handle goes away on the runtime thread itself.
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let Some(thread) = self.thread.take() else {
            return;
        };
        if thread.thread().id() != thread::current().id() {
            let _ = thread.join();
        }
    }
}
