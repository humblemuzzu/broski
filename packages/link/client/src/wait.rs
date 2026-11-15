//! Waiting from any executor. UniFFI polls an exported future on the foreign caller's thread, which
//! has no tokio runtime, so nothing here may touch a tokio timer directly: a deadline is a sleep
//! spawned onto the link runtime and awaited through its `JoinHandle`, which any executor can poll,
//! and aborted when the wait is dropped. `Notify` and `oneshot` need no runtime at all.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use broski_link_session::LinkRuntime;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio::time::Instant;

/// A task on the link runtime that stops when whoever waits for it stops waiting.
struct Spawned<T>(JoinHandle<T>);

impl<T> Future for Spawned<T> {
    type Output = Option<T>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        Pin::new(&mut self.0).poll(cx).map(Result::ok)
    }
}

impl<T> Drop for Spawned<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Resolves at `deadline` on the link runtime's clock; never if the runtime has stopped.
pub(crate) async fn until(runtime: &LinkRuntime, deadline: Instant) {
    // A `Sleep` finds its timer when it is made, so it is made on the runtime, not here.
    let sleep = Spawned(
        runtime
            .handle()
            .spawn(async move { tokio::time::sleep_until(deadline).await }),
    );
    if sleep.await.is_none() {
        std::future::pending::<()>().await;
    }
}

/// Waits for `notify`, or until `deadline` when there is one.
pub(crate) async fn notified(runtime: &LinkRuntime, notify: &Notify, deadline: Option<Instant>) {
    match deadline {
        None => notify.notified().await,
        Some(deadline) => {
            tokio::select! {
                biased;
                () = notify.notified() => {}
                () = until(runtime, deadline) => {}
            }
        }
    }
}

/// `future`'s output, or `None` once `deadline` passed first.
pub(crate) async fn within<F: Future>(
    runtime: &LinkRuntime,
    deadline: Instant,
    future: F,
) -> Option<F::Output> {
    tokio::select! {
        biased;
        output = future => Some(output),
        () = until(runtime, deadline) => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::task::{Wake, Waker};
    use std::thread::Thread;
    use std::time::Duration;

    use super::*;

    struct Unpark(Thread);

    impl Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }

    /// Polls `future` on this thread, which runs no tokio runtime, as UniFFI polls on a Swift or
    /// Kotlin thread.
    fn foreign<F: Future>(future: F) -> F::Output {
        let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
        let mut context = Context::from_waker(&waker);
        let mut future = std::pin::pin!(future);
        loop {
            if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
                return output;
            }
            std::thread::park();
        }
    }

    #[test]
    fn a_deadline_passes_for_a_caller_that_runs_no_runtime() {
        let runtime = LinkRuntime::new().expect("runtime");
        let window = Duration::from_millis(50);
        let started = std::time::Instant::now();
        let deadline = Instant::now() + window;
        let outcome = foreign(within(&runtime, deadline, std::future::pending::<()>()));
        assert_eq!(outcome, None);
        assert!(started.elapsed() >= window);
    }

    #[test]
    fn a_notify_wakes_a_caller_that_runs_no_runtime_before_its_deadline() {
        let runtime = LinkRuntime::new().expect("runtime");
        let notify = Arc::new(Notify::new());
        let notifier = Arc::clone(&notify);
        runtime.handle().spawn(async move { notifier.notify_one() });
        let far = Instant::now() + Duration::from_secs(3600);
        foreign(notified(&runtime, &notify, Some(far)));
        assert_eq!(foreign(within(&runtime, far, async { 7 })), Some(7));
    }
}
