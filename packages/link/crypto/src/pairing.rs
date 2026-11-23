use core::fmt;

use zeroize::Zeroize;

use crate::error::{Error, Result};
use crate::uri;

pub const MAX_NAME_LEN: usize = 64;
pub const MAX_LAN_ENTRIES: usize = 8;

const URI_PREFIX: &str = "broski://pair?";
const URI_VERSION: u8 = 2;
const RELAY_SCHEMES: [&str; 2] = ["wss://", "ws://"];

pub struct PairingOffer {
    pub fingerprint: [u8; 32],
    pub secret: [u8; 32],
    pub relay: Option<String>,
    pub lan: Vec<String>,
    pub name: String,
    pub expires_at: u64,
}

impl PairingOffer {
    pub fn to_uri(&self) -> String {
        let mut uri = format!(
            "{URI_PREFIX}v={URI_VERSION}&h={}&s={}&e={}&n={}",
            uri::base64_encode(&self.fingerprint),
            uri::base64_encode(&self.secret),
            self.expires_at,
            uri::percent_encode(&self.name),
        );
        if let Some(relay) = &self.relay {
            uri.push_str("&r=");
            uri.push_str(&uri::percent_encode(relay));
        }
        if !self.lan.is_empty() {
            uri.push_str("&l=");
            uri.push_str(&self.lan.join(","));
        }
        uri
    }

    pub fn parse(uri: &str) -> Result<Self> {
        let query = uri.strip_prefix(URI_PREFIX).ok_or(Error::NotAPairUri)?;
        let raw = Raw::parse(query)?;

        let version: u8 = raw
            .version
            .ok_or(Error::Malformed("missing v"))?
            .parse()
            .map_err(|_| Error::Malformed("pair uri version"))?;
        if version != URI_VERSION {
            return Err(Error::UnsupportedVersion(version));
        }

        let fingerprint =
            uri::base64_decode_array(raw.fingerprint.ok_or(Error::Malformed("missing h"))?)?;
        let secret = uri::base64_decode_array(raw.secret.ok_or(Error::Malformed("missing s"))?)?;
        let expires_at: u64 = raw
            .expires
            .ok_or(Error::Malformed("missing e"))?
            .parse()
            .map_err(|_| Error::Malformed("pair uri expiry"))?;

        let name = uri::percent_decode(raw.name.ok_or(Error::Malformed("missing n"))?)?;
        if name.len() > MAX_NAME_LEN {
            return Err(Error::Malformed("pair name too long"));
        }

        let relay = match raw.relay {
            Some(value) => Some(relay_url(&uri::percent_decode(value)?)?),
            None => None,
        };
        let lan = match raw.lan {
            Some(value) => lan_hosts(&uri::percent_decode(value)?)?,
            None => Vec::new(),
        };

        Ok(Self {
            fingerprint,
            secret,
            relay,
            lan,
            name,
            expires_at,
        })
    }

    pub fn is_expired(&self, now_secs: u64) -> bool {
        now_secs >= self.expires_at
    }
}

impl Drop for PairingOffer {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

impl fmt::Debug for PairingOffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingOffer")
            .field("fingerprint", &uri::base64_encode(&self.fingerprint))
            .field("secret", &"<redacted>")
            .field("relay", &self.relay)
            .field("lan", &self.lan)
            .field("name", &self.name)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

fn set_once<'a>(slot: &mut Option<&'a str>, value: &'a str) -> Result<()> {
    if slot.replace(value).is_some() {
        return Err(Error::Malformed("duplicate pair uri parameter"));
    }
    Ok(())
}

#[derive(Default)]
struct Raw<'a> {
    version: Option<&'a str>,
    fingerprint: Option<&'a str>,
    secret: Option<&'a str>,
    expires: Option<&'a str>,
    name: Option<&'a str>,
    relay: Option<&'a str>,
    lan: Option<&'a str>,
}

impl<'a> Raw<'a> {
    fn parse(query: &'a str) -> Result<Self> {
        let mut raw = Self::default();
        for parameter in query.split('&') {
            let (key, value) = parameter
                .split_once('=')
                .ok_or(Error::Malformed("pair uri parameter"))?;
            match key {
                "v" => set_once(&mut raw.version, value)?,
                "h" => set_once(&mut raw.fingerprint, value)?,
                "s" => set_once(&mut raw.secret, value)?,
                "e" => set_once(&mut raw.expires, value)?,
                "n" => set_once(&mut raw.name, value)?,
                "r" => set_once(&mut raw.relay, value)?,
                "l" => set_once(&mut raw.lan, value)?,
                _ => return Err(Error::Malformed("unknown pair uri parameter")),
            }
        }
        Ok(raw)
    }
}

fn relay_url(value: &str) -> Result<String> {
    if RELAY_SCHEMES.iter().any(|scheme| value.starts_with(scheme)) {
        Ok(value.to_string())
    } else {
        Err(Error::Malformed("relay url scheme"))
    }
}

fn lan_hosts(value: &str) -> Result<Vec<String>> {
    let entries: Vec<&str> = value.split(',').collect();
    if entries.len() > MAX_LAN_ENTRIES {
        return Err(Error::Malformed("too many lan entries"));
    }
    entries.iter().map(|entry| lan_host(entry)).collect()
}

/// `host:port` with a hostname, IPv4 literal, or bracketed IPv6 literal (`[addr]:port`).
fn lan_host(value: &str) -> Result<String> {
    let (host, port) = if let Some(rest) = value.strip_prefix('[') {
        let (ip, port) = rest.split_once("]:").ok_or(Error::Malformed("lan entry"))?;
        let _: std::net::Ipv6Addr = ip.parse().map_err(|_| Error::Malformed("lan host"))?;
        (ip, port)
    } else {
        let (host, port) = value
            .rsplit_once(':')
            .ok_or(Error::Malformed("lan entry"))?;
        let host_ok = !host.is_empty()
            && host
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
        if !host_ok {
            return Err(Error::Malformed("lan host"));
        }
        (host, port)
    };
    let _ = host;
    let port: u16 = port.parse().map_err(|_| Error::Malformed("lan port"))?;
    if port == 0 {
        return Err(Error::Malformed("lan port"));
    }
    Ok(value.to_string())
}
