use std::io;
use std::process::ExitCode;

use clap::Parser;
use tokio::net::TcpListener;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use broski_relay::limits::{Limits, RateLimit};
use broski_relay::Options;

mod config;

use config::Args;

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    match run(args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            error!(error = %error, "relay stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Args) -> io::Result<()> {
    let push = broski_relay::push::config::load(args.push_args())
        .await
        .map_err(io::Error::other)?;
    let register_token = match &args.register_token_file {
        Some(path) => {
            let token = std::fs::read_to_string(path)?.trim().to_owned();
            if token.len() < 16 {
                return Err(io::Error::other(format!(
                    "{}: a register token needs at least 16 characters",
                    path.display()
                )));
            }
            Some(token)
        }
        None => None,
    };
    if register_token.is_some() {
        info!("new machines register only with the register token");
    }
    let hub = broski_relay::open(Options {
        db_path: args.db.clone(),
        rate: RateLimit::default(),
        limits: Limits::default(),
        push,
        register_token,
    })
    .await
    .map_err(|error| io::Error::other(format!("database {}: {error}", args.db.display())))?;
    info!(db = %args.db.display(), "database ready");
    let shutdown = shutdown_signal();
    match (args.tls_cert, args.tls_key) {
        (Some(cert), Some(key)) => {
            info!(addr = %args.listen, "listening with tls");
            broski_relay::serve_tls(args.listen, cert, key, hub, shutdown).await
        }
        _ => {
            let listener = TcpListener::bind(args.listen).await?;
            if !args.listen.ip().is_loopback() {
                warn!(
                    addr = %args.listen,
                    "listening without TLS on a non-loopback address: put a TLS proxy in front, or pass --tls-cert and --tls-key"
                );
            }
            info!(addr = %args.listen, "listening");
            broski_relay::serve(listener, hub, shutdown).await
        }
    }
}

async fn shutdown_signal() {
    let interrupt = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = interrupt => {}
        _ = terminate => {}
    }
}
