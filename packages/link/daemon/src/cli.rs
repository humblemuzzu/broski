use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use crate::config::{self, DEFAULT_BRIDGE_SOCKET, DEFAULT_LAN_PORT};
use crate::durations::Durations;
use crate::error::Result;
use crate::RunOptions;

#[derive(Parser)]
#[command(name = "broski-link", version, about = "Broski Link machine daemon")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Run the daemon: LAN listener, relay client, control socket and bridge piping
    Run(RunArgs),
    /// Ask the running daemon for a pairing QR code
    Pair(HomeArgs),
    /// Show machine, bridge, relay and session status
    Status(OutputArgs),
    /// List paired devices
    Devices(OutputArgs),
    /// Remove a paired device by id prefix (at least 8 characters)
    Revoke(RevokeArgs),
}

#[derive(Args)]
pub struct HomeArgs {
    /// State directory; defaults to $BROSKI_LINK_HOME or ~/.broski/link
    #[arg(long, value_name = "PATH")]
    pub home: Option<PathBuf>,
}

#[derive(Args)]
pub struct OutputArgs {
    #[command(flatten)]
    pub home: HomeArgs,
    /// Print the raw JSON reply
    #[arg(long)]
    pub json: bool,
}

#[derive(Args)]
pub struct RevokeArgs {
    #[command(flatten)]
    pub home: HomeArgs,
    /// Device id, or a unique prefix of at least 8 characters
    #[arg(value_name = "DEVICE")]
    pub device: String,
}

#[derive(Args)]
pub struct RunArgs {
    #[command(flatten)]
    pub home: HomeArgs,
    /// Relay base url, e.g. wss://relay.example; overrides config.json
    #[arg(long, value_name = "URL")]
    pub relay: Option<String>,
    /// LAN listener port; overrides config.json
    #[arg(long, value_name = "PORT")]
    pub lan_port: Option<u16>,
    /// Do not listen on the LAN
    #[arg(long)]
    pub no_lan: bool,
    /// Do not announce the machine over mDNS
    #[arg(long)]
    pub no_advertise: bool,
    /// Bridge unix socket path; defaults to <home>/bridge.sock
    #[arg(long, value_name = "PATH")]
    pub bridge_socket: Option<PathBuf>,
    /// Supervise this bridge command, appending --link-socket <path>
    #[arg(long, value_name = "PROGRAM", num_args = 1.., allow_hyphen_values = true)]
    pub bridge_cmd: Option<Vec<String>>,
}

impl RunArgs {
    pub fn options(self) -> Result<RunOptions> {
        let home = config::home(self.home.home);
        let config = config::read(&home)?;
        Ok(RunOptions {
            bridge_socket: self
                .bridge_socket
                .unwrap_or_else(|| home.join(DEFAULT_BRIDGE_SOCKET)),
            relay: self.relay.or(config.relay),
            lan_port: self
                .lan_port
                .or(config.lan_port)
                .unwrap_or(DEFAULT_LAN_PORT),
            lan: !self.no_lan && config.lan.unwrap_or(true),
            advertise: !self.no_advertise,
            scan_interfaces: true,
            screen_port: broski_screen::DEFAULT_SCREEN_PORT,
            watch_dialogs: true,
            bridge_cmd: self.bridge_cmd,
            home,
            durations: Durations::default(),
        })
    }
}
