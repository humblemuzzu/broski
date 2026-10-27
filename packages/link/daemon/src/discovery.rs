use std::sync::Arc;

use mdns_sd::{ServiceDaemon, ServiceInfo};
use tracing::{debug, info, warn};

/// The service the phone browses for, in the `local.` domain.
pub const SERVICE_TYPE: &str = "_broski-link._tcp.local.";

const MAX_LABEL_BYTES: usize = 63;
const FALLBACK_LABEL: &str = "broski-link";
const DOMAIN: &str = ".local.";
const TXT_ID: &str = "id";
const TXT_VERSION: &str = "v";
const VERSION: &str = "1";

/// The machine's DNS-SD advertisement: `_broski-link._tcp` with the machine id and the protocol
/// version in its TXT records, on the port the LAN listener actually bound.
///
/// The addresses are left to the responder (`enable_addr_auto`), which follows the interfaces as
/// they come and go, so every non-loopback address the LAN listener serves is advertised.
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

    /// Withdraws the advertisement with goodbye records before the responder shuts down.
    pub fn withdraw(&self) {
        if let Err(error) = self.daemon.unregister(self.info.get_fullname()) {
            debug!(error = %error, "the advertisement was not withdrawn");
        }
        if let Err(error) = self.daemon.shutdown() {
            debug!(error = %error, "the mdns responder did not shut down");
        }
    }
}

fn service_info(name: &str, id: &str, port: u16) -> Option<ServiceInfo> {
    let instance = instance_label(name);
    let host = format!("{}{DOMAIN}", host_label(name));
    let properties = [(TXT_ID, id), (TXT_VERSION, VERSION)];
    match ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &properties[..]) {
        Ok(info) => Some(info.enable_addr_auto()),
        Err(error) => {
            warn!(error = %error, "the mdns service description is not valid");
            None
        }
    }
}

/// A DNS-SD instance label: printable, no label separator, at most 63 bytes, and never empty.
fn instance_label(name: &str) -> String {
    sanitise(name, |character| {
        character != '.' && !character.is_control()
    })
}

/// A DNS host label: a name an A record can be attached to.
fn host_label(name: &str) -> String {
    let label = sanitise(name, |character| {
        character.is_ascii_alphanumeric() || character == '-'
    })
    .to_ascii_lowercase();
    let trimmed = label.trim_matches('-');
    if trimmed.is_empty() {
        FALLBACK_LABEL.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn sanitise(name: &str, keep: impl Fn(char) -> bool) -> String {
    let mut out = String::new();
    for character in name.trim().chars() {
        if character.len_utf8() + out.len() > MAX_LABEL_BYTES {
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

    #[test]
    fn a_machine_name_becomes_a_valid_instance_label() {
        assert_eq!(
            instance_label("Sam's MacBook Pro"),
            "Sam's MacBook Pro"
        );
        assert_eq!(instance_label("mac.local"), "mac-local");
        assert_eq!(instance_label("  "), FALLBACK_LABEL);
        assert_eq!(instance_label("line\nbreak"), "line-break");
        let long = "m".repeat(300);
        assert_eq!(instance_label(&long).len(), MAX_LABEL_BYTES);
    }

    #[test]
    fn a_host_label_keeps_only_what_an_a_record_takes() {
        assert_eq!(host_label("Sams MacBook Pro"), "sams-macbook-pro");
        assert_eq!(host_label("mac.local"), "mac-local");
        assert_eq!(host_label("???"), FALLBACK_LABEL);
    }

    #[test]
    fn the_service_carries_the_machine_id_the_version_and_the_bound_port() {
        let id = "0123456789abcdef0123456789abcdef";
        let info = service_info("mac", id, 18275).expect("a valid service description");
        assert_eq!(info.get_type(), SERVICE_TYPE);
        assert_eq!(info.get_fullname(), format!("mac.{SERVICE_TYPE}"));
        assert_eq!(info.get_port(), 18275);
        assert_eq!(info.get_property_val_str(TXT_ID), Some(id));
        assert_eq!(info.get_property_val_str(TXT_VERSION), Some(VERSION));
        assert!(
            info.is_addr_auto(),
            "the responder follows the machine's addresses"
        );
        assert_eq!(info.get_hostname(), format!("mac{DOMAIN}"));
    }
}
