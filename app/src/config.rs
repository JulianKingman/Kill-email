//! Settings file (`config.toml`) and where the app keeps its data.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub account: Account,
    #[serde(default)]
    pub safety: Safety,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub security: Security,
    #[serde(default = "default_inbox")]
    pub inbox: String,
    /// Overrides the folder the server marks as \Trash
    pub trash: Option<String>,
    /// Overrides the folder the server marks as \Sent
    pub sent: Option<String>,
    /// Outgoing server for unsubscribe emails; worked out from `host` when unset
    pub smtp: Option<Smtp>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Smtp {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub security: Security,
}

impl Account {
    /// Where unsubscribe emails go out from, if there is anywhere
    pub fn smtp_server(&self) -> Option<Smtp> {
        self.smtp
            .clone()
            .or_else(|| crate::providers::smtp_for(&self.host))
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    /// TLS from the first byte (port 993)
    #[default]
    Tls,
    /// Plain connection upgraded with STARTTLS (port 143)
    Starttls,
    /// No encryption. Only accepted for localhost, for testing
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Safety {
    /// Never delete mail newer than this many days
    pub recent_days: u32,
    /// Addresses (`me@x.com`) or domains (`@x.com`) that are never touched
    pub trusted: Vec<String>,
    /// Messages whose subject contains any of these are never touched
    pub review_patterns: Vec<String>,
    /// How many Sent messages to read when learning who you write to
    pub sent_scan_limit: usize,
    /// Scan only the newest N inbox messages (0 = everything)
    pub scan_limit: usize,
}

impl Default for Safety {
    fn default() -> Self {
        Self {
            recent_days: 14,
            trusted: Vec::new(),
            review_patterns: [
                "legal notice",
                "subpoena",
                "court",
                "jury",
                "tax",
                "irs",
                "lawsuit",
                "security alert",
                "password reset",
            ]
            .map(String::from)
            .to_vec(),
            sent_scan_limit: 5000,
            scan_limit: 0,
        }
    }
}

fn default_port() -> u16 {
    993
}

fn default_inbox() -> String {
    "INBOX".into()
}

pub fn project_dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("email", "killall", "kill-email").context("could not find a home directory")
}

pub fn default_config_path() -> Result<PathBuf> {
    Ok(project_dirs()?.config_dir().join("config.toml"))
}

pub fn journal_path() -> Result<PathBuf> {
    Ok(project_dirs()?.data_dir().join("journal.jsonl"))
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| {
            format!(
                "no settings at {}. Run `kill-email` to set up your account",
                path.display()
            )
        })?;
        let config: Config =
            toml::from_str(&text).with_context(|| format!("could not read {}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    /// Settings written by the app. The password is never part of them.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = format!(
            "# Kill All Email settings. Change them in the app (press ,) rather than here.\n\n{}",
            toml::to_string_pretty(self)?
        );
        std::fs::write(path, text).with_context(|| format!("could not save {}", path.display()))
    }

    pub fn new_account(host: &str, port: u16, username: &str, security: Security) -> Self {
        Self {
            account: Account {
                host: host.into(),
                port,
                username: username.into(),
                security,
                inbox: default_inbox(),
                trash: None,
                sent: None,
                smtp: None,
            },
            safety: Safety::default(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        let local = matches!(
            self.account.host.as_str(),
            "localhost" | "127.0.0.1" | "::1"
        );
        if self.account.security == Security::None && !local {
            bail!(
                "security = \"none\" sends your password unencrypted; it is only allowed for localhost"
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_settings_load_back() {
        let dir = std::env::temp_dir().join(format!("kill-email-config-{}", std::process::id()));
        let path = dir.join("config.toml");
        let mut config = Config::new_account("imap.gmail.com", 993, "me@gmail.com", Security::Tls);
        config.safety.trusted.push("@family.org".into());
        config.save(&path).unwrap();
        let back = Config::load(&path).unwrap();
        assert_eq!(back.account.host, "imap.gmail.com");
        assert_eq!(back.safety.trusted, vec!["@family.org".to_string()]);
        assert_eq!(back.safety.recent_days, 14);
        // Protected subjects mention "password reset", but no password setting is ever written
        assert!(
            !std::fs::read_to_string(&path)
                .unwrap()
                .contains("password =")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plaintext_only_on_localhost() {
        let mut config = Config::new_account("imap.gmail.com", 993, "me@gmail.com", Security::None);
        assert!(config.validate().is_err());
        config.account.host = "127.0.0.1".into();
        assert!(config.validate().is_ok());
    }
}
