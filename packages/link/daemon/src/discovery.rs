use std::sync::Arc;
use std::time::Duration;

use mdns_sd::{IfKind, ServiceDaemon, ServiceInfo};
use tracing::{debug, info, warn};

/// The service the phone browses for, in the `local.` domain.
pub const SERVICE_TYPE: &str = "_broski-link._tcp.local.";

const MAX_LABEL_BYTES: usize = 63;
const FALLBACK_LABEL: &str = "broski-link";
const DOMAIN: &str = ".local.";
const TXT_ID: &str = "id";
const TXT_VERSION: &str = "v";
const VERSION: &str = "1";
/// How much of the machine id the instance and host names carry to stay unique on a network.
const NAME_ID_CHARS: usize = 8;
/// How long the responder may take to confirm the first goodbye and to stop.
const RESPONDER_ANSWER: Duration = Duration::from_secs(1);
/// mdns-sd repeats a goodbye 120 ms after the first; this leaves room for that repeat to go out.
const GOODBYE_REPEAT: Duration = Duration::from_millis(250);

/// The machine's DNS-SD advertisement: `_broski-link._tcp` with the machine id and the protocol
/// version in its TXT records, on the port the LAN listener actually bound.
///
/// The addresses are left to the responder (`enable_addr_auto`), which follows the interfaces as
/// they come and go, so every non-loopback address the LAN listener serves is advertised.
///
/// The instance and host names carry the start of the machine id, so no other machine can own
/// them, and probing is off: a restarted daemon must not see the records its previous run left in
/// caches as a rival and rename itself away from the name phones already know.
pub struct Advertisement {
    daemon: ServiceDaemon,
    info: ServiceInfo,
}

impl Advertisement {
    pub fn start(name: &str, id: &str, port: u16) -> Option<Arc<Advertisement>> {
        if port == 0 {
            debug!("no lan port to advertise");
            return None;
        }
        let daemon = match ServiceDaemon::new() {
            Ok(daemon) => daemon,
            Err(error) => {
                warn!(error = %error, "mdns is unavailable; the machine is not advertised");
                return None;
            }
        };
        if let Err(error) = daemon.disable_interface(vec![IfKind::LoopbackV4, IfKind::LoopbackV6]) {
            debug!(error = %error, "loopback stays in the advertisement");
        }
        let info = service_info(name, id, port)?;
        if let Err(error) = daemon.register(info.clone()) {
            warn!(error = %error, "the machine could not be advertised");
            let _ = daemon.shutdown();
            return None;
        }
        info!(
            instance = info.get_fullname(),
            port, "advertising the machine over mdns"
        );
        Some(Arc::new(Advertisement { daemon, info }))
    }

    /// Re-announces after an address scan saw the interface set change.
    pub fn refresh(&self) {
        if let Err(error) = self.daemon.register(self.info.clone()) {
            debug!(error = %error, "the advertisement was not refreshed");
        }
    }

    /// Withdraws the advertisement and waits until its goodbye records, the repeat included, are
    /// on the wire, so caches drop the old port now rather than when its TTL runs out. Blocks for
    /// at most a few seconds; call it off the async runtime.
    pub fn withdraw(&self) {
        match self.daemon.unregister(self.info.get_fullname()) {
            Ok(confirmed) => match confirmed.recv_timeout(RESPONDER_ANSWER) {
                Ok(_) => std::thread::sleep(GOODBYE_REPEAT),
                Err(error) => debug!(error = %error, "the goodbye was not confirmed"),
            },
            Err(error) => debug!(error = %error, "the advertisement was not withdrawn"),
        }
        match self.daemon.shutdown() {
            Ok(stopped) => {
                if let Err(error) = stopped.recv_timeout(RESPONDER_ANSWER) {
                    debug!(error = %error, "the mdns responder did not confirm its stop");
                }
            }
            Err(error) => debug!(error = %error, "the mdns responder did not shut down"),
        }
        info!(
            instance = self.info.get_fullname(),
            "mdns advertisement withdrawn"
        );
    }
}

fn service_info(name: &str, id: &str, port: u16) -> Option<ServiceInfo> {
    let short = short_id(id);
    let instance = instance_label(name, short);
    let host = format!("{}{DOMAIN}", host_label(name, short));
    let properties = [(TXT_ID, id), (TXT_VERSION, VERSION)];
    match ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &properties[..]) {
        Ok(info) => {
            let mut info = info.enable_addr_auto();
            info.set_requires_probe(false);
            Some(info)
        }
        Err(error) => {
            warn!(error = %error, "the mdns service description is not valid");
            None
        }
    }
}

fn short_id(id: &str) -> &str {
    id.get(..NAME_ID_CHARS).unwrap_or(id)
}

/// A DNS-SD instance label: the machine name with the start of its id, printable, no label
/// separator, at most 63 bytes, and never empty.
fn instance_label(name: &str, short: &str) -> String {
    let suffix = format!(" ({short})");
    let base = sanitise(name, MAX_LABEL_BYTES - suffix.len(), |character| {
        character != '.' && !character.is_control()
    });
    format!("{base}{suffix}")
}

/// A DNS host label: a name an A record can be attached to, unique to this machine.
fn host_label(name: &str, short: &str) -> String {
    let suffix = format!("-{short}");
    let label = sanitise(name, MAX_LABEL_BYTES - suffix.len(), |character| {
        character.is_ascii_alphanumeric() || character == '-'
    })
    .to_ascii_lowercase();
    let trimmed = label.trim_matches('-');
    let base = if trimmed.is_empty() {
        FALLBACK_LABEL
    } else {
        trimmed
    };
    format!("{base}{suffix}")
}

fn sanitise(name: &str, max_bytes: usize, keep: impl Fn(char) -> bool) -> String {
    let mut out = String::new();
    for character in name.trim().chars() {
        if character.len_utf8() + out.len() > max_bytes {
            break;
        }
        out.push(if keep(character) { character } else { '-' });
    }
    let trimmed = out.trim().trim_matches('-').trim();
    if trimmed.is_empty() {
        FALLBACK_LABEL.to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT: &str = "01234567";

    #[test]
    fn a_machine_name_becomes_a_valid_instance_label_that_names_the_machine() {
        assert_eq!(
            instance_label("Sam's MacBook Pro", SHORT),
            "Sam's MacBook Pro (01234567)"
        );
        assert_eq!(instance_label("mac.local", SHORT), "mac-local (01234567)");
        assert_eq!(instance_label("  ", SHORT), "broski-link (01234567)");
        assert_eq!(
            instance_label("line\nbreak", SHORT),
            "line-break (01234567)"
        );
        let long = instance_label(&"m".repeat(300), SHORT);
        assert_eq!(long.len(), MAX_LABEL_BYTES);
        assert!(long.ends_with(" (01234567)"), "the id survives truncation");
    }

    #[test]
    fn a_host_label_keeps_only_what_an_a_record_takes_and_names_the_machine() {
        assert_eq!(
            host_label("Sams MacBook Pro", SHORT),
            "sams-macbook-pro-01234567"
        );
        assert_eq!(host_label("mac.local", SHORT), "mac-local-01234567");
        assert_eq!(host_label("???", SHORT), "broski-link-01234567");
        assert!(host_label(&"m".repeat(300), SHORT).len() <= MAX_LABEL_BYTES);
    }

    #[test]
    fn the_service_carries_the_machine_id_the_version_and_the_bound_port() {
        let id = "0123456789abcdef0123456789abcdef";
        let info = service_info("mac", id, 18275).expect("a valid service description");
        assert_eq!(info.get_type(), SERVICE_TYPE);
        assert_eq!(
            info.get_fullname(),
            format!("mac (01234567).{SERVICE_TYPE}")
        );
        assert_eq!(info.get_port(), 18275);
        assert_eq!(info.get_property_val_str(TXT_ID), Some(id));
        assert_eq!(info.get_property_val_str(TXT_VERSION), Some(VERSION));
        assert!(
            info.is_addr_auto(),
            "the responder follows the machine's addresses"
        );
        assert!(
            !info.requires_probe(),
            "a restart never renames the machine away from the name phones know"
        );
        assert_eq!(info.get_hostname(), format!("mac-01234567{DOMAIN}"));
    }
}
