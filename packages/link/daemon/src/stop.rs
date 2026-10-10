use tokio::sync::watch;

/// Resolves once the daemon is asked to stop. A plain `wait_for` in a `select!` arm would drag its
/// read guard into the arm's type; this future is `()` so the arm stays `Send`.
pub async fn stopped(receiver: &mut watch::Receiver<bool>) {
    let _ = receiver.wait_for(|stopped| *stopped).await;
}
