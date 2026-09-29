//! Unsubscribing from senders, using what their List-Unsubscribe headers offer (RFC 2369, RFC 8058).
//!
//! In order of preference: a one-click POST, an unsubscribe email sent from your account,
//! and last, opening the sender's unsubscribe page in your browser for you to finish.

use std::time::Duration;

use anyhow::{Context, Result, bail};

use crate::config::{Account, Security, Smtp};
use crate::mail::Unsubscribe;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    OneClick,
    Email,
    WebPage,
}

impl Method {
    pub fn done_label(self) -> &'static str {
        match self {
            Method::OneClick => "unsubscribed",
            Method::Email => "unsubscribe email sent",
            Method::WebPage => "unsubscribe page opened",
        }
    }
}

/// The ways out: an HTTP client, an outgoing mail server and a browser
pub trait Channels {
    /// RFC 8058 one-click: POST `List-Unsubscribe=One-Click` to the https link
    fn post_one_click(&mut self, url: &str) -> Result<()>;
    /// Send an unsubscribe email; `None` when there is no outgoing server
    fn send_email(&mut self, email: &MailtoLink) -> Option<Result<()>>;
    fn open_page(&mut self, url: &str) -> Result<()>;
}

/// Unsubscribe with the best method available; returns the method that worked.
/// When one fails the next is tried, and the first error is kept if none works.
pub fn unsubscribe(how: &Unsubscribe, channels: &mut dyn Channels) -> Result<Method> {
    let mut first_error = None;
    let mut note = |e: anyhow::Error| {
        first_error.get_or_insert(e);
    };

    if how.one_click
        && let Some(url) = how.https.as_deref()
    {
        match channels.post_one_click(url) {
            Ok(()) => return Ok(Method::OneClick),
            Err(e) => note(e.context("one-click unsubscribe failed")),
        }
    }
    if let Some(link) = how.mailto.as_deref().and_then(MailtoLink::parse) {
        match channels.send_email(&link) {
            Some(Ok(())) => return Ok(Method::Email),
            Some(Err(e)) => note(e.context("unsubscribe email failed")),
            None => {}
        }
    }
    if let Some(url) = how.https.as_deref() {
        match channels.open_page(url) {
            Ok(()) => return Ok(Method::WebPage),
            Err(e) => note(e.context("couldn't open the unsubscribe page")),
        }
    }
    Err(first_error.unwrap_or_else(|| anyhow::anyhow!("this sender offers no way to unsubscribe")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailtoLink {
    pub to: String,
    pub subject: String,
    pub body: String,
}

impl MailtoLink {
    /// Parse `mailto:list@example.com?subject=unsubscribe&body=...`
    pub fn parse(link: &str) -> Option<Self> {
        let rest = link
            .get(..7)
            .filter(|p| p.eq_ignore_ascii_case("mailto:"))
            .map(|_| &link[7..])?;
        let (to, query) = rest.split_once('?').unwrap_or((rest, ""));
        let to = percent_decode(to).trim().to_string();
        if !to.contains('@') || to.contains(',') || to.contains(char::is_whitespace) {
            return None;
        }
        let mut out = MailtoLink {
            to,
            subject: "unsubscribe".into(),
            body: "unsubscribe".into(),
        };
        for pair in query.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let v = percent_decode(v);
            match k.to_ascii_lowercase().as_str() {
                "subject" if !v.trim().is_empty() => out.subject = v,
                "body" if !v.trim().is_empty() => out.body = v,
                _ => {}
            }
        }
        Some(out)
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The real thing: HTTPS, your outgoing mail server, and your browser
pub struct Live {
    from: String,
    password: String,
    smtp: Option<Smtp>,
    http: ureq::Agent,
}

impl Live {
    pub fn new(account: &Account, password: &str) -> Self {
        let http = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .https_only(true)
            .build()
            .into();
        Self {
            from: account.username.clone(),
            password: password.to_string(),
            smtp: account.smtp_server(),
            http,
        }
    }
}

impl Channels for Live {
    fn post_one_click(&mut self, url: &str) -> Result<()> {
        if !url.starts_with("https://") {
            bail!("one-click links must be https");
        }
        let response = self
            .http
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .send("List-Unsubscribe=One-Click")?;
        let status = response.status();
        if !status.is_success() {
            bail!("the sender's server answered {status}");
        }
        Ok(())
    }

    fn send_email(&mut self, email: &MailtoLink) -> Option<Result<()>> {
        let smtp = self.smtp.as_ref()?;
        Some(send_smtp(smtp, &self.from, &self.password, email))
    }

    fn open_page(&mut self, url: &str) -> Result<()> {
        if !url.starts_with("https://") && !url.starts_with("http://") {
            bail!("not a web link");
        }
        open::that_detached(url).context("no browser to open it in")
    }
}

fn send_smtp(smtp: &Smtp, from: &str, password: &str, email: &MailtoLink) -> Result<()> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let message = Message::builder()
        .from(from.parse().context("your address")?)
        .to(email.to.parse().context("the unsubscribe address")?)
        .subject(&email.subject)
        .body(email.body.clone())?;
    let builder = match smtp.security {
        Security::Tls => SmtpTransport::relay(&smtp.host)?,
        Security::Starttls => SmtpTransport::starttls_relay(&smtp.host)?,
        Security::None => {
            let local = matches!(smtp.host.as_str(), "localhost" | "127.0.0.1" | "::1");
            if !local {
                bail!("unencrypted mail servers are only allowed on this machine");
            }
            SmtpTransport::builder_dangerous(&smtp.host)
        }
    };
    let mut builder = builder
        .port(smtp.port)
        .timeout(Some(Duration::from_secs(20)));
    if smtp.security != Security::None {
        builder = builder.credentials(Credentials::new(from.to_string(), password.to_string()));
    }
    builder
        .build()
        .send(&message)
        .with_context(|| format!("sending through {}", smtp.host))?;
    Ok(())
}

/// Pretends to unsubscribe, for the demo inbox and dry runs
#[derive(Default)]
pub struct Pretend {
    pub calls: Vec<String>,
}

impl Channels for Pretend {
    fn post_one_click(&mut self, url: &str) -> Result<()> {
        self.calls.push(format!("post {url}"));
        Ok(())
    }

    fn send_email(&mut self, email: &MailtoLink) -> Option<Result<()>> {
        self.calls.push(format!("mail {}", email.to));
        Some(Ok(()))
    }

    fn open_page(&mut self, url: &str) -> Result<()> {
        self.calls.push(format!("open {url}"));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn how(https: Option<&str>, mailto: Option<&str>, one_click: bool) -> Unsubscribe {
        Unsubscribe {
            https: https.map(String::from),
            mailto: mailto.map(String::from),
            one_click,
        }
    }

    #[test]
    fn mailto_links_parse() {
        let l =
            MailtoLink::parse("mailto:leave%2B42@list.example?subject=Unsub%20me&body=").unwrap();
        assert_eq!(l.to, "leave+42@list.example");
        assert_eq!(l.subject, "Unsub me");
        assert_eq!(l.body, "unsubscribe");
        assert_eq!(
            MailtoLink::parse("MAILTO:a@b.example").unwrap().to,
            "a@b.example"
        );
        assert!(MailtoLink::parse("mailto:nobody").is_none());
        assert!(MailtoLink::parse("mailto:a@b.example,c@d.example").is_none());
        assert!(MailtoLink::parse("https://x.example").is_none());
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%4"), "%4");
    }

    #[test]
    fn prefers_one_click_then_email_then_the_page() {
        let mut p = Pretend::default();
        let both = how(
            Some("https://x.example/u"),
            Some("mailto:u@x.example"),
            true,
        );
        assert_eq!(unsubscribe(&both, &mut p).unwrap(), Method::OneClick);
        let no_click = how(
            Some("https://x.example/u"),
            Some("mailto:u@x.example"),
            false,
        );
        assert_eq!(unsubscribe(&no_click, &mut p).unwrap(), Method::Email);
        let page = how(Some("https://x.example/u"), None, false);
        assert_eq!(unsubscribe(&page, &mut p).unwrap(), Method::WebPage);
        assert!(unsubscribe(&how(None, None, false), &mut p).is_err());
        assert_eq!(
            p.calls,
            [
                "post https://x.example/u",
                "mail u@x.example",
                "open https://x.example/u"
            ]
        );
    }

    struct Failing;
    impl Channels for Failing {
        fn post_one_click(&mut self, _: &str) -> Result<()> {
            bail!("503")
        }
        fn send_email(&mut self, _: &MailtoLink) -> Option<Result<()>> {
            None
        }
        fn open_page(&mut self, _: &str) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn falls_back_when_one_click_fails() {
        let h = how(
            Some("https://x.example/u"),
            Some("mailto:u@x.example"),
            true,
        );
        assert_eq!(unsubscribe(&h, &mut Failing).unwrap(), Method::WebPage);
    }
}
