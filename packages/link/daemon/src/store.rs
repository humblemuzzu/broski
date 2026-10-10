use std::path::{Path, PathBuf};
use std::sync::Arc;

use broski_link_core::crypto::PublicBundle;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

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
        let state: MachineState = match fsx::read(&state_path)? {
            Some(bytes) => serde_json::from_slice(&bytes)?,
            None => {
                let fresh = MachineState {
                    relay_secret: codec::b64url(&crate::clock::bytes::<SECRET_BYTES>()?),
                    name: hostname(),
                };
                fsx::write_atomic(&state_path, &serde_json::to_vec(&fresh)?)?;
                fresh
            }
        };
        let secret = codec::b64url_decode(&state.relay_secret)
            .filter(|bytes| bytes.len() == SECRET_BYTES)
            .ok_or_else(|| {
                Error::message(format!(
                    "{}: relay_secret must be 32 b64url bytes",
                    state_path.display()
                ))
            })?;

        let devices_path = home.join(DEVICES_FILE);
        let devices: Vec<DeviceRecord> = match fsx::read(&devices_path)? {
            Some(bytes) => serde_json::from_slice(&bytes)?,
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

    /// Returns `None` when the device limit is reached; a re-pair of a known device rotates its token.
    pub async fn pair_device(
        &self,
        bundle: &PublicBundle,
    ) -> Result<Option<(DeviceRecord, Zeroizing<String>)>> {
        let id = bundle.id();
        let token = Zeroizing::new(codec::b64url(&crate::clock::bytes::<SECRET_BYTES>()?));
        let record = DeviceRecord {
            id: id.clone(),
            name: String::new(),
            platform: String::new(),
            public: codec::b64url(&bundle.to_bytes()),
            role: ROLE_OWNER.to_owned(),
            relay_token_hash: codec::token_hash(&token),
            paired_at: crate::clock::unix_secs(),
            push: None,
        };

        let mut data = self.data.lock().await;
        match data.devices.iter().position(|device| device.id == id) {
            Some(index) => data.devices[index] = record.clone(),
            None if data.devices.len() >= MAX_DEVICES => return Ok(None),
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
