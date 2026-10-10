pub(crate) mod alerts;
pub mod auth;
pub mod db;
pub mod device_socket;
pub mod http;
pub mod hub;
pub(crate) mod letters;
mod limiter;
pub mod limits;
pub mod machine_socket;
pub mod protocol;
pub mod push;
pub mod room;
pub mod socket;
mod store;

use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use tokio::net::TcpListener;

use crate::db::DbError;
use crate::hub::Hub;
use crate::limits::{Limits, RateLimit, SHUTDOWN_DRAIN};
use crate::push::{PushConfig, PushSender};
use crate::socket::CLOSE_RESTART;

pub struct Options {
    pub db_path: PathBuf,
    pub rate: RateLimit,
    pub limits: Limits,
    pub push: PushConfig,
}

pub async fn open(options: Options) -> Result<Arc<Hub>, DbError> {
    let db = db::Db::open(&options.db_path).await?;
    let hub = Arc::new(Hub::new(
        db,
        options.rate,
        options.limits,
        PushSender::new(options.push),
    ));
    letters::spawn_sweeper(hub.clone());
    Ok(hub)
}

pub fn router(hub: Arc<Hub>) -> Router {
    http::router(hub)
}

pub async fn serve(
    listener: TcpListener,
    hub: Arc<Hub>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let stopping = hub.clone();
    let graceful = async move {
        shutdown.await;
        stopping.close_all(CLOSE_RESTART, "service restart");
    };
    axum::serve(
        listener,
        router(hub).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(graceful)
    .await
}

pub async fn serve_tls(
    addr: SocketAddr,
    cert: PathBuf,
    key: PathBuf,
    hub: Arc<Hub>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, key).await?;
    let handle: axum_server::Handle<SocketAddr> = axum_server::Handle::new();
    let stopping = handle.clone();
    let graceful_hub = hub.clone();
    tokio::spawn(async move {
        shutdown.await;
        graceful_hub.close_all(CLOSE_RESTART, "service restart");
        stopping.graceful_shutdown(Some(SHUTDOWN_DRAIN));
    });
    let app = router(hub).into_make_service_with_connect_info::<SocketAddr>();
    axum_server::tls_rustls::bind_rustls(addr, config)
        .handle(handle)
        .serve(app)
        .await
}
