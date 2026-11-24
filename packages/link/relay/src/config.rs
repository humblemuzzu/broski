use std::net::SocketAddr;
use std::path::PathBuf;

use broski_relay::push::config::{ApnsArgs, PushArgs};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "broski-relay", version, about = "Broski Link relay")]
pub struct Args {
    /// Address to listen on, e.g. 0.0.0.0:8765
    #[arg(long)]
    pub listen: SocketAddr,

    /// SQLite database path, created when missing
    #[arg(long)]
    pub db: PathBuf,

    /// File holding a token (16+ characters) a machine must present to register here; without it
    /// any machine may register. Machines already registered are unaffected.
    #[arg(long, value_name = "PATH")]
    pub register_token_file: Option<PathBuf>,

    /// PEM certificate chain; enables TLS when given together with --tls-key
    #[arg(long, requires = "tls_key")]
    pub tls_cert: Option<PathBuf>,

    /// PEM private key for --tls-cert
    #[arg(long, requires = "tls_cert")]
    pub tls_key: Option<PathBuf>,

    /// APNs .p8 signing key; enables push to iOS devices
    #[arg(long, requires_all = ["apns_key_id", "apns_team_id", "apns_topic"])]
    pub apns_key: Option<PathBuf>,

    /// APNs key id of --apns-key
    #[arg(long, requires = "apns_key")]
    pub apns_key_id: Option<String>,

    /// APNs team id of --apns-key
    #[arg(long, requires = "apns_key")]
    pub apns_team_id: Option<String>,

    /// App bundle id used as the APNs topic
    #[arg(long, requires = "apns_key")]
    pub apns_topic: Option<String>,

    /// Use the APNs sandbox host
    #[arg(long, requires = "apns_key")]
    pub apns_sandbox: bool,

    /// Firebase service account JSON; enables push to Android devices
    #[arg(long)]
    pub fcm_service_account: Option<PathBuf>,

    /// Relay without provider keys forwards pushes to this relay's /v1/push
    #[arg(long)]
    pub push_upstream: Option<String>,

    /// Override the APNs base url
    #[arg(long, hide = true)]
    pub apns_endpoint: Option<String>,

    /// Override the FCM base url
    #[arg(long, hide = true)]
    pub fcm_endpoint: Option<String>,

    /// Override the FCM OAuth token url
    #[arg(long, hide = true)]
    pub fcm_token_endpoint: Option<String>,
}

impl Args {
    pub fn push_args(&self) -> PushArgs {
        PushArgs {
            apns: match (
                &self.apns_key,
                &self.apns_key_id,
                &self.apns_team_id,
                &self.apns_topic,
            ) {
                (Some(key), Some(key_id), Some(team_id), Some(topic)) => Some(ApnsArgs {
                    key: key.clone(),
                    key_id: key_id.clone(),
                    team_id: team_id.clone(),
                    topic: topic.clone(),
                    sandbox: self.apns_sandbox,
                }),
                _ => None,
            },
            fcm_service_account: self.fcm_service_account.clone(),
            upstream: self.push_upstream.clone(),
            apns_endpoint: self.apns_endpoint.clone(),
            fcm_endpoint: self.fcm_endpoint.clone(),
            fcm_token_endpoint: self.fcm_token_endpoint.clone(),
        }
    }
}
