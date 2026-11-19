use std::path::{Path, PathBuf};
use std::sync::Arc;

use broski_link_core::crypto::PublicBundle;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

use crate::codec;
use crate::device::{hostname, DeviceRecord, PushRegistration, ROLE_OWNER};
use crate::error::{Error, Result};
use crate::fsx;

const STATE_FILE: &str = "state.json";
const DEVICES_FILE: &str = "devices.json";
const SECRET_BYTES: usize = 32;
const MAX_DEVICES: usize = 32;

#[derive(Serialize, Deserialize)]
struct MachineState {
    relay_secret: String,
    name: String,
}

struct Data {
    devices: Vec<DeviceRecord>,
}

/// The daemon's durable state: one machine secret, a name, and the paired devices.
pub struct Store {
    home: PathBuf,
    name: String,
    secret: Zeroizing<Vec<u8>>,
    data: Mutex<Data>,
}

impl Store {
    pub async fn open(home: &Path) -> Result<Arc<Store>> {
        let state_path = home.join(STATE_FILE);
        let mut state: MachineState = match fsx::read_json(&state_path, "the machine state")? {
            Some(state) => state,
            None => {
                let fresh = MachineState {
                    relay_secret: codec::b64url(&crate::clock::bytes::<SECRET_BYTES>()?),
                    name: hostname(),
                };
                fsx::write_atomic(&state_path, &serde_json::to_vec(&fresh)?)?;
                fresh
            }
        };
        let decoded =
            codec::b64url_decode(&state.relay_secret).filter(|bytes| bytes.len() == SECRET_BYTES);
        state.relay_secret.zeroize();
        let secret = decoded.ok_or_else(|| {
            Error::message(format!(
                "{}: relay_secret must be 32 b64url bytes",
                state_path.display()
            ))
        })?;

        let devices_path = home.join(DEVICES_FILE);
        let devices: Vec<DeviceRecord> = match fsx::read_json(&devices_path, "the paired devices")?
        {
            Some(devices) => devices,
            None => {
                fsx::write_atomic(&devices_path, b"[]")?;
                Vec::new()
            }
        };

        Ok(Arc::new(Store {
            home: home.to_path_buf(),
            name: state.name,
            secret: Zeroizing::new(secret),
            data: Mutex::new(Data { devices }),
        }))
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }

    pub async fn devices(&self) -> Vec<DeviceRecord> {
        self.data.lock().await.devices.clone()
    }

    pub async fn device(&self, id: &str) -> Option<DeviceRecord> {
        self.data
            .lock()
            .await
            .devices
            .iter()
            .find(|device| device.id == id)
            .cloned()
    }

    /// Returns `None` when the device limit is reached. A re-pair of a known device rotates its
    /// token and keeps what the device has already told this machine: its name, its platform and
    /// its push registration.
    pub async fn pair_device(
        &self,
        bundle: &PublicBundle,
    ) -> Result<Option<(DeviceRecord, Zeroizing<String>)>> {
        let id = bundle.id();
        let token = Zeroizing::new(codec::b64url(&crate::clock::bytes::<SECRET_BYTES>()?));
        let mut data = self.data.lock().await;
        let known = data.devices.iter().find(|device| device.id == id).cloned();
        if known.is_none() && data.devices.len() >= MAX_DEVICES {
            return Ok(None);
        }
        let record = DeviceRecord {
            id: id.clone(),
            name: known
                .as_ref()
                .map(|device| device.name.clone())
                .unwrap_or_default(),
            platform: known
                .as_ref()
                .map(|device| device.platform.clone())
                .unwrap_or_default(),
            public: codec::b64url(&bundle.to_bytes()),
            role: ROLE_OWNER.to_owned(),
            relay_token_hash: codec::token_hash(&token),
            paired_at: crate::clock::unix_secs(),
            push: known.as_ref().and_then(|device| device.push.clone()),
            live_activity_token: known.and_then(|device| device.live_activity_token),
        };

        match data.devices.iter().position(|device| device.id == id) {
            Some(index) => data.devices[index] = record.clone(),
            None => data.devices.push(record.clone()),
        }
        self.persist(&data.devices).await?;
        Ok(Some((record, token)))
    }

    pub async fn set_identity(&self, id: &str, name: &str, platform: &str) -> Result<DeviceRecord> {
        let mut data = self.data.lock().await;
        let index = data
            .devices
            .iter()
            .position(|device| device.id == id)
            .ok_or_else(|| Error::message(format!("unknown device {id}")))?;
        data.devices[index].name = crate::device::clamp_name(name);
        data.devices[index].platform = platform.to_owned();
        let updated = data.devices[index].clone();
        self.persist(&data.devices).await?;
        Ok(updated)
    }

    /// Replaces the device's push registration, or clears it. `None` when the device is unknown.
    pub async fn set_push(
        &self,
        id: &str,
        push: Option<PushRegistration>,
    ) -> Result<Option<DeviceRecord>> {
        let mut data = self.data.lock().await;
        let Some(index) = data.devices.iter().position(|device| device.id == id) else {
            return Ok(None);
        };
        data.devices[index].push = push;
        let updated = data.devices[index].clone();
        self.persist(&data.devices).await?;
        Ok(Some(updated))
    }

    /// Replaces the device's active iOS Live Activity push token, or clears it.
    pub async fn set_live_activity(
        &self,
        id: &str,
        token: Option<String>,
    ) -> Result<Option<DeviceRecord>> {
        let mut data = self.data.lock().await;
        let Some(index) = data.devices.iter().position(|device| device.id == id) else {
            return Ok(None);
        };
        if data.devices[index].live_activity_token == token {
            return Ok(Some(data.devices[index].clone()));
        }
        data.devices[index].live_activity_token = token;
        let updated = data.devices[index].clone();
        self.persist(&data.devices).await?;
        Ok(Some(updated))
    }

    pub async fn remove_device(&self, id: &str) -> Result<Option<DeviceRecord>> {
        let mut data = self.data.lock().await;
        let Some(index) = data.devices.iter().position(|device| device.id == id) else {
            return Ok(None);
        };
        let removed = data.devices.remove(index);
        self.persist(&data.devices).await?;
        Ok(Some(removed))
    }

    async fn persist(&self, devices: &[DeviceRecord]) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(devices)?;
        let path = self.home.join(DEVICES_FILE);
        tokio::task::spawn_blocking(move || fsx::write_atomic(&path, &bytes))
            .await
            .map_err(|error| Error::message(format!("device write task failed: {error}")))??;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use broski_link_core::crypto::StaticIdentity;

    use super::*;

    async fn store() -> (tempfile::TempDir, Arc<Store>) {
        let dir = tempfile::tempdir().expect("temp home");
        fsx::ensure_dir(dir.path()).expect("home");
        let store = Store::open(dir.path()).await.expect("store");
        (dir, store)
    }

    #[tokio::test]
    async fn pairing_a_known_device_again_keeps_its_name_platform_and_push() {
        let (_dir, store) = store().await;
        let identity = StaticIdentity::generate().expect("device identity");
        let (record, first) = store
            .pair_device(&identity.public())
            .await
            .expect("pair")
            .expect("room for the device");
        store
            .set_identity(&record.id, "pixel", "android")
            .await
            .expect("identity");
        store
            .set_push(
                &record.id,
                Some(PushRegistration {
                    platform: "fcm".to_owned(),
                    token: "token".to_owned(),
                    key: "key".to_owned(),
                }),
            )
            .await
            .expect("push");

        let (again, second) = store
            .pair_device(&identity.public())
            .await
            .expect("pair again")
            .expect("the device is still there");
        assert_ne!(first.as_str(), second.as_str(), "the relay token rotates");
        assert_eq!(again.name, "pixel");
        assert_eq!(again.platform, "android");
        assert_eq!(
            again.push.map(|push| push.token),
            Some("token".to_owned()),
            "the phone does not have to register for alerts again"
        );
    }

    #[tokio::test]
    async fn an_unreadable_device_list_moves_aside_and_the_daemon_starts_empty() {
        let dir = tempfile::tempdir().expect("temp home");
        fsx::ensure_dir(dir.path()).expect("home");
        std::fs::write(dir.path().join(DEVICES_FILE), b"[{ this is not json").expect("write");
        let store = Store::open(dir.path()).await.expect("the daemon starts");
        assert!(store.devices().await.is_empty());
        assert!(
            std::fs::read_dir(dir.path())
                .expect("list")
                .filter_map(|entry| entry.ok())
                .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")),
            "the unreadable file is kept aside, not deleted"
        );
    }

    #[tokio::test]
    async fn an_unreadable_machine_state_is_replaced_with_a_fresh_one() {
        let dir = tempfile::tempdir().expect("temp home");
        fsx::ensure_dir(dir.path()).expect("home");
        std::fs::write(dir.path().join(STATE_FILE), b"{\"relay_secret\":").expect("write");
        let store = Store::open(dir.path()).await.expect("the daemon starts");
        assert_eq!(store.secret().len(), SECRET_BYTES);
    }
}
