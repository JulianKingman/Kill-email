//! The safety floor: what Kill Email will never delete, whatever mode it is in.

use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};

use crate::config::Safety;
use crate::mail::MessageMeta;

/// Why a message or sender is protected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Hold {
    /// You have sent mail to this address
    Correspondent,
    /// Listed under `trusted` in the settings
    Trusted,
    Flagged,
    /// You replied to this message
    Answered,
    /// Newer than `recent_days`
    Recent,
    /// Subject matches a legal/tax/security pattern
    Sensitive,
    /// No Message-ID, so it could not be found again to undo
    Unrestorable,
}

impl Hold {
    pub fn label(self) -> &'static str {
        match self {
            Hold::Correspondent => "you write to them",
            Hold::Trusted => "trusted sender",
            Hold::Flagged => "starred",
            Hold::Answered => "you replied",
            Hold::Recent => "recent",
            Hold::Sensitive => "legal/tax/security",
            Hold::Unrestorable => "can't be undone",
        }
    }
}

pub struct SafetyRules {
    pub correspondents: HashSet<String>,
    trusted: Vec<String>,
    patterns: Vec<String>,
    cutoff: DateTime<Utc>,
}

impl SafetyRules {
    pub fn new(safety: &Safety, correspondents: HashSet<String>, now: DateTime<Utc>) -> Self {
        Self {
            correspondents,
            trusted: safety.trusted.iter().map(|t| t.trim().to_lowercase()).collect(),
            patterns: safety.review_patterns.iter().map(|p| p.to_lowercase()).collect(),
            cutoff: now - Duration::days(i64::from(safety.recent_days)),
        }
    }

    /// Protection that covers everything from this sender
    pub fn sender_hold(&self, address: &str) -> Option<Hold> {
        if self.correspondents.contains(address) {
            return Some(Hold::Correspondent);
        }
        let domain = address.rsplit_once('@').map(|(_, d)| d).unwrap_or("");
        let trusted = self.trusted.iter().any(|t| {
            let t = t.trim_start_matches('@');
            t == address || t == domain || domain.ends_with(&format!(".{t}"))
        });
        trusted.then_some(Hold::Trusted)
    }

    /// Protection for one message, in priority order
    pub fn message_hold(&self, msg: &MessageMeta) -> Option<Hold> {
        if msg.flagged {
            return Some(Hold::Flagged);
        }
        if msg.answered {
            return Some(Hold::Answered);
        }
        // An undated message counts as recent: unknown age is not old enough
        if msg.date.is_none_or(|d| d >= self.cutoff) {
            return Some(Hold::Recent);
        }
        let subject = msg.subject.to_lowercase();
        if self.patterns.iter().any(|p| contains_word(&subject, p)) {
            return Some(Hold::Sensitive);
        }
        if msg.message_id.is_none() {
            return Some(Hold::Unrestorable);
        }
        None
    }
}

/// `pattern` appears in `text` on word boundaries, so "tax" matches "tax return" but not "taxi"
fn contains_word(text: &str, pattern: &str) -> bool {
    let is_word = |c: char| c.is_alphanumeric();
    let mut start = 0;
    while let Some(pos) = text[start..].find(pattern) {
        let begin = start + pos;
        let end = begin + pattern.len();
        let before_ok = text[..begin].chars().next_back().is_none_or(|c| !is_word(c));
        let after_ok = text[end..].chars().next().is_none_or(|c| !is_word(c));
        if before_ok && after_ok {
            return true;
        }
        start = begin + pattern.len().max(1);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::Unsubscribe;

    fn msg(from: &str, days_old: i64) -> MessageMeta {
        MessageMeta {
            uid: 1,
            message_id: Some("id@x".into()),
            from: from.into(),
            from_name: None,
            subject: "Weekly deals".into(),
            date: Some(Utc::now() - Duration::days(days_old)),
            seen: false,
            flagged: false,
            answered: false,
            size: 100,
            unsubscribe: Unsubscribe::default(),
            bulk: true,
        }
    }

    fn rules(trusted: &[&str]) -> SafetyRules {
        let safety = Safety { trusted: trusted.iter().map(|s| s.to_string()).collect(), ..Safety::default() };
        SafetyRules::new(&safety, HashSet::from(["mom@family.example".to_string()]), Utc::now())
    }

    #[test]
    fn correspondents_and_trusted_domains_are_protected() {
        let r = rules(&["@work.example", "friend@pals.example"]);
        assert_eq!(r.sender_hold("mom@family.example"), Some(Hold::Correspondent));
        assert_eq!(r.sender_hold("boss@work.example"), Some(Hold::Trusted));
        assert_eq!(r.sender_hold("hr@eu.work.example"), Some(Hold::Trusted));
        assert_eq!(r.sender_hold("friend@pals.example"), Some(Hold::Trusted));
        assert_eq!(r.sender_hold("deals@shopmart.example"), None);
        assert_eq!(r.sender_hold("x@notwork.example"), None);
    }

    #[test]
    fn message_holds() {
        let r = rules(&[]);
        assert_eq!(r.message_hold(&msg("a@b.example", 60)), None);
        assert_eq!(r.message_hold(&msg("a@b.example", 3)), Some(Hold::Recent));

        let mut m = msg("a@b.example", 60);
        m.flagged = true;
        assert_eq!(r.message_hold(&m), Some(Hold::Flagged));

        let mut m = msg("a@b.example", 60);
        m.answered = true;
        assert_eq!(r.message_hold(&m), Some(Hold::Answered));

        let mut m = msg("a@b.example", 60);
        m.subject = "Your 2025 tax documents".into();
        assert_eq!(r.message_hold(&m), Some(Hold::Sensitive));

        let mut m = msg("a@b.example", 60);
        m.subject = "Taxi rides 20% off".into();
        assert_eq!(r.message_hold(&m), None);

        let mut m = msg("a@b.example", 60);
        m.message_id = None;
        assert_eq!(r.message_hold(&m), Some(Hold::Unrestorable));

        let mut m = msg("a@b.example", 60);
        m.date = None;
        assert_eq!(r.message_hold(&m), Some(Hold::Recent));
    }
}
