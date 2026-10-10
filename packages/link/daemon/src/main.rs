use clap::Parser;

use broski_link_daemon::cli::{Cli, Command};
use broski_link_daemon::{client, run_command};

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Run(args) => {
            init_logging();
            match run_command(args).await {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(error) => fail(error),
            }
        }
        Command::Pair(args) => report(client::pair(args)),
        Command::Status(args) => report(client::status(args)),
        Command::Devices(args) => report(client::devices(args)),
        Command::Revoke(args) => report(client::revoke(args)),
    }
}

fn init_logging() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

fn report(outcome: Result<String, String>) -> std::process::ExitCode {
    match outcome {
        Ok(text) => {
            print!("{text}");
            std::process::ExitCode::SUCCESS
        }
        Err(message) => fail(message),
    }
}

fn fail(error: impl std::fmt::Display) -> std::process::ExitCode {
    eprintln!("broski-link: {error}");
    std::process::ExitCode::FAILURE
}
