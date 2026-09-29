//! The mail password lives in the system keychain (macOS Keychain, Windows Credential
//! Manager, or the Secret Service on Linux), never in the settings file.

use anyhow::{Context, Result};

const SERVICE: &str = "email.killall.kill-email";

/// The password to use: `KILL_EMAIL_PASSWORD` if set, otherwise the keychain
pub fn load(username: &str) -> Option<String> {
    if let Ok(p) = std::env::var("KILL_EMAIL_PASSWORD") {
        return Some(p);
    }
    keyring::Entry::new(SERVICE, username)
        .ok()?
        .get_password()
        .ok()
        .filter(|p| !p.is_empty())
}

pub fn save(username: &str, password: &str) -> Result<()> {
    keyring::Entry::new(SERVICE, username)?
        .set_password(password)
        .context("the system keychain refused the password")
}

pub fn forget(username: &str) -> Result<()> {
    match keyring::Entry::new(SERVICE, username)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
