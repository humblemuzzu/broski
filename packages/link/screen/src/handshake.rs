use crate::client::{AuthScheme, Client, RunState, ScreenEvent, State, PREFERRED_ENCODINGS};
use crate::crypto::{ard_dh_response, vnc_des_response};
use crate::decode::Decoders;
use crate::error::{Error, Result};
use crate::framebuffer::Framebuffer;
use crate::wire::{
    sec, write_fb_update_request, write_set_encodings, write_set_pixel_format, PixelFormat,
};

impl Client {
    pub(crate) fn step_version(&mut self) -> Result<bool> {
        if self.rx.len() < 12 {
            return Ok(false);
        }
        let banner = std::str::from_utf8(&self.rx[..12])
            .map_err(|_| Error::UnsupportedVersion("non-utf8 banner".to_owned()))?
            .to_owned();
        if !banner.starts_with("RFB ") || !banner.ends_with('\n') {
            return Err(Error::UnsupportedVersion(banner));
        }
        let major: u16 = banner[4..7]
            .parse()
            .map_err(|_| Error::UnsupportedVersion(banner.clone()))?;
        let minor: u16 = banner[8..11]
            .parse()
            .map_err(|_| Error::UnsupportedVersion(banner.clone()))?;
        if major != 3 {
            return Err(Error::UnsupportedVersion(banner));
        }
        self.rx.drain(..12);
        match minor {
            889 => {
                // Reply 003.008 so macOS screensharingd still offers Apple ARD (type 30) auth
                // while speaking standard RFC 6143 server messages with no proprietary surprises.
                self.minor_version = 8;
                self.apple_server = true;
                self.tx.extend_from_slice(b"RFB 003.008\n");
                self.state = State::SecurityTypes;
            }
            8..=u16::MAX => {
                self.minor_version = 8;
                self.tx.extend_from_slice(b"RFB 003.008\n");
                self.state = State::SecurityTypes;
            }
            7 => {
                self.minor_version = 7;
                self.tx.extend_from_slice(b"RFB 003.007\n");
                self.state = State::SecurityTypes;
            }
            3..=6 => {
                self.minor_version = 3;
                self.tx.extend_from_slice(b"RFB 003.003\n");
                self.state = State::SecurityV33;
            }
            _ => return Err(Error::UnsupportedVersion(banner)),
        }
        Ok(true)
    }

    pub(crate) fn step_security_types(&mut self) -> Result<bool> {
        if self.rx.is_empty() {
            return Ok(false);
        }
        let count = usize::from(self.rx[0]);
        if count == 0 {
            if self.rx.len() < 5 {
                return Ok(false);
            }
            let len = u32::from_be_bytes([self.rx[1], self.rx[2], self.rx[3], self.rx[4]]) as usize;
            self.rx.drain(..5);
            self.state = State::SecurityFailReason { len: len.min(4096) };
            return Ok(true);
        }
        if self.rx.len() < 1 + count {
            return Ok(false);
        }
        let offered = self.rx[1..1 + count].to_vec();
        self.rx.drain(..1 + count);
        self.choose_security(&offered)?;
        Ok(true)
    }

    pub(crate) fn step_security_v33(&mut self) -> Result<bool> {
        if self.rx.len() < 4 {
            return Ok(false);
        }
        let code = u32::from_be_bytes([self.rx[0], self.rx[1], self.rx[2], self.rx[3]]);
        if code == 0 {
            if self.rx.len() < 8 {
                return Ok(false);
            }
            let len = u32::from_be_bytes([self.rx[4], self.rx[5], self.rx[6], self.rx[7]]) as usize;
            self.rx.drain(..8);
            self.state = State::SecurityFailReason { len: len.min(4096) };
            return Ok(true);
        }
        self.rx.drain(..4);
        match code {
            1 => self.send_client_init(),
            2 => self.choose_security(&[sec::VNC_AUTH])?,
            _ => return Err(Error::UnsupportedSecurity),
        }
        Ok(true)
    }

    pub(crate) fn choose_security(&mut self, offered: &[u8]) -> Result<()> {
        let has_user_pass = self
            .credentials
            .as_ref()
            .is_some_and(|c| !c.username.is_empty() && !c.password.is_empty());
        let has_pass = self
            .credentials
            .as_ref()
            .is_some_and(|c| !c.password.is_empty());

        if offered.contains(&sec::ARD) && has_user_pass {
            self.select_security(sec::ARD, State::ArdChallenge);
            return Ok(());
        }
        if offered.contains(&sec::NONE) {
            if self.minor_version >= 7 {
                self.tx.push(sec::NONE);
            }
            if self.minor_version >= 8 {
                self.state = State::SecurityResult;
            } else {
                self.send_client_init();
            }
            return Ok(());
        }
        if offered.contains(&sec::VNC_AUTH) && has_pass {
            self.select_security(sec::VNC_AUTH, State::VncChallenge);
            return Ok(());
        }
        self.request_credentials(offered)
    }

    fn select_security(&mut self, code: u8, next: State) {
        if self.minor_version >= 7 {
            self.tx.push(code);
        }
        self.state = next;
    }

    fn request_credentials(&mut self, offered: &[u8]) -> Result<()> {
        let mut schemes = Vec::new();
        if offered.contains(&sec::ARD) {
            schemes.push(AuthScheme::AppleCredentials);
        }
        if offered.contains(&sec::VNC_AUTH) {
            schemes.push(AuthScheme::VncPassword);
        }
        if schemes.is_empty() {
            return Err(Error::UnsupportedSecurity);
        }
        self.events.push_back(ScreenEvent::AuthRequired { schemes });
        self.state = State::WaitingCredentials {
            offered: offered.to_vec(),
        };
        Ok(())
    }

    pub(crate) fn step_vnc_challenge(&mut self) -> Result<bool> {
        if self.rx.len() < 16 {
            return Ok(false);
        }
        let challenge: [u8; 16] = self.rx[..16].try_into().unwrap();
        self.rx.drain(..16);
        let creds = self.credentials.take().unwrap_or_default();
        let response = vnc_des_response(&creds.password, &challenge);
        self.tx.extend_from_slice(&response);
        self.state = State::SecurityResult;
        Ok(true)
    }

    pub(crate) fn step_ard_challenge(&mut self) -> Result<bool> {
        if self.rx.len() < 4 {
            return Ok(false);
        }
        let generator = u16::from_be_bytes([self.rx[0], self.rx[1]]);
        let key_len = usize::from(u16::from_be_bytes([self.rx[2], self.rx[3]]));
        let need = 4 + key_len * 2;
        if self.rx.len() < need {
            return Ok(false);
        }
        let prime = self.rx[4..4 + key_len].to_vec();
        let server_pub = self.rx[4 + key_len..need].to_vec();
        self.rx.drain(..need);
        let creds = self.credentials.take().unwrap_or_default();
        let response = ard_dh_response(
            generator,
            &prime,
            &server_pub,
            &creds.username,
            &creds.password,
        )?;
        self.tx.extend_from_slice(&response);
        self.state = State::SecurityResult;
        Ok(true)
    }

    pub(crate) fn step_security_result(&mut self) -> Result<bool> {
        if self.rx.len() < 4 {
            return Ok(false);
        }
        let status = u32::from_be_bytes([self.rx[0], self.rx[1], self.rx[2], self.rx[3]]);
        if status == 0 {
            self.rx.drain(..4);
            self.send_client_init();
            return Ok(true);
        }
        if self.minor_version >= 8 {
            if self.rx.len() < 8 {
                return Ok(false);
            }
            let len = u32::from_be_bytes([self.rx[4], self.rx[5], self.rx[6], self.rx[7]]) as usize;
            self.rx.drain(..8);
            self.state = State::SecurityFailReason { len: len.min(4096) };
            return Ok(true);
        }
        self.rx.drain(..4);
        Err(Error::AuthRejected)
    }

    pub(crate) fn step_security_fail_reason(&mut self) -> Result<bool> {
        let State::SecurityFailReason { len } = self.state else {
            return Ok(false);
        };
        if self.rx.len() < len {
            return Ok(false);
        }
        let msg = String::from_utf8_lossy(&self.rx[..len]).into_owned();
        self.rx.drain(..len);
        if msg.is_empty() {
            Err(Error::AuthRejected)
        } else {
            Err(Error::AuthFailed(msg))
        }
    }

    pub(crate) fn step_server_init(&mut self) -> Result<bool> {
        if self.rx.len() < 24 {
            return Ok(false);
        }
        let width = u16::from_be_bytes([self.rx[0], self.rx[1]]);
        let height = u16::from_be_bytes([self.rx[2], self.rx[3]]);
        let name_len =
            u32::from_be_bytes([self.rx[20], self.rx[21], self.rx[22], self.rx[23]]) as usize;
        if name_len > 4096 {
            return Err(Error::Protocol("desktop name too long".to_owned()));
        }
        if self.rx.len() < 24 + name_len {
            return Ok(false);
        }
        let desktop_name = String::from_utf8_lossy(&self.rx[24..24 + name_len]).into_owned();
        self.rx.drain(..24 + name_len);

        let fb = Framebuffer::new(width, height)?;
        write_set_pixel_format(&mut self.tx, PixelFormat::RGBA8888);
        write_set_encodings(&mut self.tx, PREFERRED_ENCODINGS);
        write_fb_update_request(&mut self.tx, false, 0, 0, width, height);

        self.events.push_back(ScreenEvent::Ready {
            width,
            height,
            desktop_name,
            apple_server: self.apple_server,
        });
        self.state = State::Running(RunState {
            fb,
            pf: PixelFormat::RGBA8888,
            decoders: Decoders::default(),
            pending_rects: 0,
            resized_in_batch: false,
            desktop_size_supported: false,
        });
        Ok(true)
    }

    fn send_client_init(&mut self) {
        self.tx.push(1);
        self.state = State::ServerInit;
    }
}
