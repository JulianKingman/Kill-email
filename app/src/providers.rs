//! Mail providers the setup screen knows how to connect to.

use crate::config::Security;

pub struct Provider {
    pub name: &'static str,
    pub host: &'static str,
    pub port: u16,
    /// Where to get the password this app needs
    pub password_help: &'static str,
    /// Why it can't be used yet, if it can't
    pub unavailable: Option<&'static str>,
}

pub const OTHER: usize = 5;

pub const PROVIDERS: [Provider; 6] = [
    Provider {
        name: "Gmail",
        host: "imap.gmail.com",
        port: 993,
        password_help: "Use an app password, not your Google password. Create one at myaccount.google.com/apppasswords (needs 2-Step Verification).",
        unavailable: None,
    },
    Provider {
        name: "iCloud Mail",
        host: "imap.mail.me.com",
        port: 993,
        password_help: "Use an app-specific password from account.apple.com > Sign-In and Security.",
        unavailable: None,
    },
    Provider {
        name: "Yahoo Mail",
        host: "imap.mail.yahoo.com",
        port: 993,
        password_help: "Use an app password from Yahoo Account Security > Generate app password.",
        unavailable: None,
    },
    Provider {
        name: "Fastmail",
        host: "imap.fastmail.com",
        port: 993,
        password_help: "Use an app password from Settings > Privacy & Security > Integrations.",
        unavailable: None,
    },
    Provider {
        name: "Outlook / Hotmail",
        host: "outlook.office365.com",
        port: 993,
        password_help: "",
        unavailable: Some(
            "Microsoft requires its own sign-in for Outlook.com mail. Support is coming.",
        ),
    },
    Provider {
        name: "Other (IMAP)",
        host: "",
        port: 993,
        password_help: "Your mail password, or an app password if your provider uses them.",
        unavailable: None,
    },
];

/// Pick the provider a saved host belongs to, so setup can start where the user left off
pub fn index_for_host(host: &str) -> usize {
    PROVIDERS
        .iter()
        .position(|p| !p.host.is_empty() && p.host.eq_ignore_ascii_case(host))
        .unwrap_or(OTHER)
}

/// TLS on 993; STARTTLS elsewhere; plain text only for a server on this machine
pub fn security_for(host: &str, port: u16) -> Security {
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    match port {
        993 => Security::Tls,
        _ if local => Security::None,
        _ => Security::Starttls,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_hosts_map_back_to_their_provider() {
        assert_eq!(PROVIDERS[index_for_host("IMAP.gmail.com")].name, "Gmail");
        assert_eq!(index_for_host("mail.example.org"), OTHER);
    }

    #[test]
    fn security_follows_the_port() {
        assert_eq!(security_for("imap.gmail.com", 993), Security::Tls);
        assert_eq!(security_for("mail.example.org", 143), Security::Starttls);
        assert_eq!(security_for("127.0.0.1", 1143), Security::None);
    }
}
