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
                "no settings at {}. Run `kill-email init` to create them",
                path.display()
            )
        })?;
        let config: Config =
            toml::from_str(&text).with_context(|| format!("could not read {}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        let local = matches!(self.account.host.as_str(), "localhost" | "127.0.0.1" | "::1");
        if self.account.security == Security::None && !local {
            bail!("security = \"none\" sends your password unencrypted; it is only allowed for localhost");
        }
        Ok(())
    }
}

pub const EXAMPLE: &str = r#"# Kill All Email settings

[account]
# Gmail: imap.gmail.com, and use an app password (Google Account > Security > App passwords)
# Outlook: outlook.office365.com   Yahoo: imap.mail.yahoo.com   iCloud: imap.mail.me.com
host = "imap.gmail.com"
port = 993
username = "you@example.com"
security = "tls"          # tls | starttls
# trash = "[Gmail]/Trash"  # only needed if your server doesn't mark its Trash folder
# sent = "[Gmail]/Sent Mail"

[safety]
recent_days = 14          # never delete mail newer than this
trusted = []              # e.g. ["boss@work.com", "@family.org"]
scan_limit = 0            # 0 scans the whole inbox
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_config_parses() {
        let config: Config = toml::from_str(EXAMPLE).unwrap();
        assert_eq!(config.account.port, 993);
        assert_eq!(config.account.security, Security::Tls);
        assert_eq!(config.safety.recent_days, 14);
    }

    #[test]
    fn plaintext_only_on_localhost() {
        let mut config: Config = toml::from_str(EXAMPLE).unwrap();
        config.account.security = Security::None;
        assert!(config.validate().is_err());
        config.account.host = "127.0.0.1".into();
        assert!(config.validate().is_ok());
    }
}
