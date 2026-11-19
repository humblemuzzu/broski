use tracing::{debug, warn};

use crate::control::{self, FromDevice, Hello, LiveActivityRegister, PushRegister};
use crate::device::{clamp_name, short, PushRegistration};
use crate::push::{keys, platform, valid_token};

use super::Actor;

impl Actor {
    /// Control messages the paired device sends on the link's control stream.
    pub(super) async fn control(&mut self, bytes: &[u8]) {
        match control::parse_device(bytes) {
            FromDevice::Hello(hello) => self.hello(hello).await,
            FromDevice::BridgeRestart => {
                if let Some(supervisor) = &self.deps.supervisor {
                    if !supervisor.restart() {
                        debug!(device = short(&self.device.id), "bridge restart ignored");
                    }
                }
            }
            FromDevice::PushRegister(register) => self.push(register).await,
            FromDevice::PushUnregister => self.push_unregister().await,
            FromDevice::LiveActivityRegister(register) => self.live_activity(register).await,
            FromDevice::LiveActivityUnregister => self.store_live_activity(None).await,
            FromDevice::Unknown => {}
        }
    }

    async fn push(&mut self, register: PushRegister) {
        let Some(platform) = platform(&register.platform) else {
            debug!(
                device = short(&self.device.id),
                "push registration with an unknown platform"
            );
            return;
        };
        if !valid_token(&register.token) {
            debug!(
                device = short(&self.device.id),
                "push registration with a malformed token"
            );
            return;
        }
        if keys::decode(&register.key).is_none() {
            debug!(
                device = short(&self.device.id),
                "push registration with a malformed key"
            );
            return;
        }
        let push = PushRegistration {
            platform: platform.to_owned(),
            token: register.token,
            key: register.key,
        };
        self.store_push(Some(push)).await;
    }

    async fn push_unregister(&mut self) {
        self.store_push(None).await;
    }

    async fn live_activity(&mut self, register: LiveActivityRegister) {
        if !valid_token(&register.token) {
            debug!(
                device = short(&self.device.id),
                "live activity registration with a malformed token"
            );
            return;
        }
        self.store_live_activity(Some(register.token)).await;
    }

    async fn store_live_activity(&mut self, token: Option<String>) {
        if let Err(error) = self
            .deps
            .store
            .set_live_activity(&self.device.id, token)
            .await
        {
            warn!(
                device = short(&self.device.id),
                error = %error,
                "live activity token not stored"
            );
        }
    }

    async fn store_push(&mut self, push: Option<PushRegistration>) {
        match self.deps.store.set_push(&self.device.id, push).await {
            Ok(Some(_)) => self.deps.relay.refresh(),
            Ok(None) => debug!(
                device = short(&self.device.id),
                "push registration for an unknown device"
            ),
            Err(error) => {
                warn!(device = short(&self.device.id), error = %error, "push registration not stored")
            }
        }
    }

    async fn hello(&mut self, hello: Hello) {
        let name = clamp_name(&hello.name);
        let platform = match hello.platform.as_str() {
            "ios" | "android" | "web" => hello.platform.clone(),
            _ => return,
        };
        if (self.device.name == name && self.device.platform == platform) || name.is_empty() {
            return;
        }
        match self
            .deps
            .store
            .set_identity(&self.device.id, &name, &platform)
            .await
        {
            Ok(record) => {
                let renamed = record.name != self.bridge.name();
                self.device = record;
                if renamed {
                    self.bridge.restart(self.device.name.clone());
                }
            }
            Err(error) => {
                warn!(device = short(&self.device.id), error = %error, "device identity not stored")
            }
        }
    }
}
