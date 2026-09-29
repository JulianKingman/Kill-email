//! Turning raw header bytes into [`MessageMeta`].

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use mail_parser::MessageParser;

use super::kind::{NOTIFICATION_HEADERS, Signals, classify};
use super::{MessageMeta, Unsubscribe};

pub struct Flags {
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
}

pub fn parse_meta(uid: u32, raw_headers: &[u8], flags: Flags, size: u32) -> MessageMeta {
    let parsed = MessageParser::default().parse_headers(raw_headers);
    let msg = parsed.as_ref();

    let sender = msg.and_then(|m| m.from()).and_then(|a| a.first());
    let from = sender
        .and_then(|a| a.address())
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let from_name = sender
        .and_then(|a| a.name())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());

    let header = |name: &str| {
        msg.and_then(|m| m.header_raw(name.to_string()))
            .map(|v| v.trim().to_string())
    };

    let unsubscribe = parse_unsubscribe(
        header("List-Unsubscribe").as_deref(),
        header("List-Unsubscribe-Post").as_deref(),
    );
    let precedence = header("Precedence").unwrap_or_default().to_lowercase();
    let bulk = !unsubscribe.is_empty()
        || header("List-Id").is_some()
        || matches!(precedence.as_str(), "bulk" | "list" | "junk");
    let subject = msg
        .and_then(|m| m.subject())
        .unwrap_or("(no subject)")
        .to_string();

    let present: Vec<&str> = NOTIFICATION_HEADERS
        .iter()
        .copied()
        .filter(|h| header(h).is_some())
        .collect();
    let list_unsubscribe = header("List-Unsubscribe");
    let auto_submitted = header("Auto-Submitted");
    let feedback_id = header("Feedback-ID");
    let x_mailer = header("X-Mailer");
    let (kind, platform) = classify(&Signals {
        from: &from,
        subject: &subject,
        bulk,
        list_unsubscribe: list_unsubscribe.as_deref(),
        auto_submitted: auto_submitted.as_deref(),
        feedback_id: feedback_id.as_deref(),
        x_mailer: x_mailer.as_deref(),
        present: &present,
    });

    MessageMeta {
        uid,
        message_id: msg
            .and_then(|m| m.message_id())
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
        from,
        from_name,
        subject,
        date: msg
            .and_then(|m| m.date())
            .and_then(|d| DateTime::<Utc>::from_timestamp(d.to_timestamp(), 0)),
        seen: flags.seen,
        flagged: flags.flagged,
        answered: flags.answered,
        size,
        unsubscribe,
        bulk,
        kind,
        platform,
    }
}

/// The Message-ID in raw headers, without angle brackets
pub fn parse_message_id(raw_headers: &[u8]) -> Option<String> {
    MessageParser::default()
        .parse_headers(raw_headers)?
        .message_id()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

/// `List-Unsubscribe: <https://...>, <mailto:...>` plus the RFC 8058 one-click marker
pub fn parse_unsubscribe(list_unsubscribe: Option<&str>, post: Option<&str>) -> Unsubscribe {
    let mut out = Unsubscribe::default();
    let Some(value) = list_unsubscribe else {
        return out;
    };
    for part in value.split('<').skip(1) {
        let Some(uri) = part.split('>').next().map(str::trim) else {
            continue;
        };
        let lower = uri.to_lowercase();
        if lower.starts_with("https://") && out.https.is_none() {
            out.https = Some(uri.to_string());
        } else if lower.starts_with("mailto:") && out.mailto.is_none() {
            out.mailto = Some(uri.to_string());
        }
    }
    // One-click needs an https URI to POST to (RFC 8058 section 3.1)
    out.one_click = out.https.is_some()
        && post
            .map(|p| {
                p.replace(' ', "")
                    .eq_ignore_ascii_case("List-Unsubscribe=One-Click")
            })
            .unwrap_or(false);
    out
}

/// Lower-cased To, Cc and Bcc addresses from raw headers
pub fn parse_recipients(raw_headers: &[u8], into: &mut HashSet<String>) {
    let Some(msg) = MessageParser::default().parse_headers(raw_headers) else {
        return;
    };
    for list in [msg.to(), msg.cc(), msg.bcc()].into_iter().flatten() {
        for addr in list.iter() {
            if let Some(a) = addr.address() {
                into.insert(a.trim().to_lowercase());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BULK: &[u8] = b"From: \"Shop Mart\" <Deals@ShopMart.example>\r\n\
Date: Mon, 01 Sep 2025 10:00:00 +0000\r\n\
Subject: 50% off everything\r\n\
Message-ID: <abc123@shopmart.example>\r\n\
List-Unsubscribe: <mailto:unsub@shopmart.example?subject=stop>, <https://shopmart.example/u/1>\r\n\
List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n";

    fn flags() -> Flags {
        Flags {
            seen: true,
            flagged: false,
            answered: false,
        }
    }

    #[test]
    fn parses_bulk_sender_headers() {
        let meta = parse_meta(7, BULK, flags(), 1234);
        assert_eq!(meta.uid, 7);
        assert_eq!(meta.from, "deals@shopmart.example");
        assert_eq!(meta.from_name.as_deref(), Some("Shop Mart"));
        assert_eq!(meta.message_id.as_deref(), Some("abc123@shopmart.example"));
        assert_eq!(meta.subject, "50% off everything");
        assert!(meta.date.is_some());
        assert!(meta.bulk);
        assert!(meta.unsubscribe.one_click);
        assert_eq!(
            meta.unsubscribe.https.as_deref(),
            Some("https://shopmart.example/u/1")
        );
        assert_eq!(meta.unsubscribe.label(), "1-click");
        assert_eq!(meta.kind, super::super::Kind::Marketing);
    }

    #[test]
    fn notification_headers_are_read() {
        let raw = b"From: GitHub <notifications@github.com>\r\n\
Subject: Re: [acme/api] Fix login\r\n\
X-GitHub-Reason: review_requested\r\n\
List-Unsubscribe: <https://github.com/notifications/unsubscribe/x>\r\n\r\n";
        let meta = parse_meta(1, raw, flags(), 10);
        assert_eq!(meta.kind, super::super::Kind::Notification);
    }

    #[test]
    fn personal_mail_is_not_bulk() {
        let raw = b"From: Mom <mom@family.example>\r\nSubject: dinner?\r\nMessage-ID: <m1@family.example>\r\n\r\n";
        let meta = parse_meta(1, raw, flags(), 10);
        assert!(!meta.bulk);
        assert_eq!(meta.kind, super::super::Kind::Personal);
        assert!(meta.unsubscribe.is_empty());
    }

    #[test]
    fn one_click_needs_https() {
        let u = parse_unsubscribe(
            Some("<mailto:x@y.example>"),
            Some("List-Unsubscribe=One-Click"),
        );
        assert!(!u.one_click);
        assert_eq!(u.label(), "mailto");
        let u = parse_unsubscribe(Some("<http://insecure.example/u>"), None);
        assert!(u.is_empty());
    }

    #[test]
    fn collects_recipients() {
        let raw =
            b"To: Mom <MOM@family.example>, dad@family.example\r\nCc: friend@pals.example\r\n\r\n";
        let mut set = HashSet::new();
        parse_recipients(raw, &mut set);
        assert!(set.contains("mom@family.example"));
        assert!(set.contains("dad@family.example"));
        assert!(set.contains("friend@pals.example"));
    }
}
