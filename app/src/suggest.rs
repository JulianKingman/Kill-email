//! Suggestions for the Kill List: which senders to unsubscribe from, and which to keep
//! but clear out. Rules for now, from how you treat each sender's mail and what kind of
//! mail it is; the on-device model will take over the unclear middle.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use crate::mail::{Kind, MessageMeta};
use crate::safety::Hold;
use crate::senders::SenderGroup;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suggestion {
    pub advice: Advice,
    /// Why, most telling first, e.g. "0 of 48 opened"
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Advice {
    /// Unsubscribe, and clear out what's there
    Unsubscribe,
    /// Mail you'd want to keep coming (receipts, reviews) but never go back to: clear it out
    ClearOut,
    /// Nothing to unsubscribe from, but you ignore it: clear it out
    KillOnly,
}

impl Advice {
    pub fn label(self) -> &'static str {
        match self {
            Advice::Unsubscribe => "unsubscribe",
            Advice::ClearOut => "clear out, stay subscribed",
            Advice::KillOnly => "clear out",
        }
    }
}

/// Fill in what the journal and Trash know about each sender, then suggest
pub fn annotate(
    groups: &mut [SenderGroup],
    trash: &[MessageMeta],
    unsubscribed: &HashMap<String, DateTime<Utc>>,
    dismissed: &HashSet<String>,
    now: DateTime<Utc>,
) {
    let mut binned: HashMap<&str, usize> = HashMap::new();
    for m in trash.iter().filter(|m| !m.seen) {
        *binned.entry(m.from.as_str()).or_default() += 1;
    }
    for g in groups {
        g.unsubscribed = unsubscribed.get(&g.address).copied();
        g.binned_unread = binned.get(g.address.as_str()).copied().unwrap_or(0);
        g.dismissed = dismissed.contains(&g.address);
        g.suggestion = suggest(g, now);
    }
}

/// Fewer messages than this isn't enough to judge by
const MIN_MESSAGES: usize = 5;
/// Opening this share or less counts as ignoring a sender
const IGNORED_PCT: u32 = 10;
/// Opening this share or more means you want it
const WANTED_PCT: u32 = 50;
/// Not opening anything for this long counts as ignoring, whatever the old read rate
const STALE_DAYS: i64 = 90;
/// Notifications are only worth clearing out once they pile up
const NOTIFICATION_PILE: usize = 20;

pub fn suggest(g: &SenderGroup, now: DateTime<Utc>) -> Option<Suggestion> {
    if g.dismissed || matches!(g.protected, Some(Hold::Correspondent | Hold::Trusted)) {
        return None;
    }
    // You engage with it: any reply, or starring more than the odd one
    if g.replied > 0 || g.starred * 20 >= g.total.max(1) || g.kind == Kind::Personal {
        return None;
    }
    let read = g.read_pct();
    if read >= WANTED_PCT || (g.total < MIN_MESSAGES && g.binned_unread < 3) {
        return None;
    }

    let stale = g
        .last_opened
        .is_none_or(|d| now - d > Duration::days(STALE_DAYS));
    let ignored = read <= IGNORED_PCT || (stale && g.total >= MIN_MESSAGES) || g.binned_unread >= 3;
    if !ignored {
        return None;
    }

    let can_trash = g.protected.is_none() && !g.targets.is_empty();
    let can_leave = g.unsubscribed.is_none() && !g.unsubscribe.is_empty();
    let advice = match g.kind {
        // You asked for these; clear them out but keep them coming
        Kind::Notification if can_trash && g.total >= NOTIFICATION_PILE => Advice::ClearOut,
        Kind::Notification | Kind::Personal => return None,
        _ if can_leave => Advice::Unsubscribe,
        _ if can_trash => Advice::KillOnly,
        _ => return None,
    };
    Some(Suggestion {
        advice,
        reasons: reasons(g, advice, now),
    })
}

fn reasons(g: &SenderGroup, advice: Advice, now: DateTime<Utc>) -> Vec<String> {
    let opened = g.total - g.unread;
    let mut out = vec![format!("{opened} of {} opened", g.total)];
    out.push(match g.last_opened {
        None => "never opened".into(),
        Some(d) if now - d > Duration::days(STALE_DAYS) => {
            format!("last opened {}", d.format("%b %Y"))
        }
        Some(_) => "opened recently".into(),
    });
    if g.binned_unread > 0 {
        out.push(format!("{} deleted unread", g.binned_unread));
    }
    out.push(match g.platform {
        Some(p) => format!("{} ({p})", g.kind.label()),
        None => g.kind.label().to_string(),
    });
    if let Some(per_week) = per_week(g).filter(|w| *w >= 2.0) {
        out.push(format!("about {per_week:.0} a week"));
    }
    match advice {
        Advice::ClearOut => out.push("likely about things you did, so stay subscribed".into()),
        Advice::KillOnly => out.push("no way to unsubscribe".into()),
        Advice::Unsubscribe => {}
    }
    out
}

/// Messages a week over the span we can see
fn per_week(g: &SenderGroup) -> Option<f64> {
    let (Some(old), Some(new)) = (g.oldest, g.newest) else {
        return None;
    };
    let weeks = ((new - old).num_days() as f64 / 7.0).max(1.0);
    Some(g.total as f64 / weeks)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::config::Safety;
    use crate::mail::{FakeStore, MailStore};
    use crate::safety::SafetyRules;
    use crate::senders::group_by_sender;

    fn demo() -> Vec<SenderGroup> {
        let mut store = FakeStore::demo();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let rules = SafetyRules::new(&Safety::default(), store.sent_to.clone(), Utc::now());
        group_by_sender(&msgs, &rules)
    }

    fn advice(groups: &[SenderGroup], address: &str) -> Option<Advice> {
        let g = groups.iter().find(|g| g.address == address).unwrap();
        suggest(g, Utc::now()).map(|s| s.advice)
    }

    #[test]
    fn suggests_like_a_person_would() {
        let groups = demo();
        let now = |a| advice(&groups, a);
        // Ignored social nudges and sales: unsubscribe, despite one starred deal
        assert_eq!(now("notify@socialnet.example"), Some(Advice::Unsubscribe));
        assert_eq!(now("alerts@bank-promos.example"), Some(Advice::Unsubscribe));
        assert_eq!(now("deals@shopmart.example"), Some(Advice::Unsubscribe));
        // Notifications you sometimes read: leave them be
        assert_eq!(now("notifications@github.com"), None);
        // Receipts you never reread: clear out, but stay subscribed
        assert_eq!(now("no-reply@rideshare.example"), Some(Advice::ClearOut));
        // A newsletter you read a third of: yours to decide
        assert_eq!(now("digest@dailybrief.example"), None);
        // Nothing to unsubscribe from, never opened
        assert_eq!(now("news@oldforum.example"), Some(Advice::KillOnly));
        // People
        assert_eq!(now("mom@family.example"), None);
        assert_eq!(now("boss@work.example"), None);
    }

    #[test]
    fn reasons_say_why() {
        let groups = demo();
        let social = groups
            .iter()
            .find(|g| g.address == "notify@socialnet.example")
            .unwrap();
        let s = suggest(social, Utc::now()).unwrap();
        assert!(s.reasons[0].ends_with("of 214 opened"), "{:?}", s.reasons);
        assert!(s.reasons.iter().any(|r| r == "social"), "{:?}", s.reasons);
    }

    #[test]
    fn a_handful_of_messages_is_not_enough() {
        let mut groups = demo();
        let g = groups
            .iter_mut()
            .find(|g| g.address == "alerts@bank-promos.example")
            .unwrap();
        g.total = 3;
        g.unread = 3;
        assert_eq!(suggest(g, Utc::now()), None);
        g.binned_unread = 4;
        assert!(
            suggest(g, Utc::now()).is_some(),
            "unless you keep binning it"
        );
        g.dismissed = true;
        assert_eq!(suggest(g, Utc::now()), None, "you said no");
    }

    #[test]
    fn replying_or_starring_often_means_keep() {
        let mut groups = demo();
        let g = groups
            .iter_mut()
            .find(|g| g.address == "notify@socialnet.example")
            .unwrap();
        g.replied = 1;
        assert_eq!(suggest(g, Utc::now()), None);
        g.replied = 0;
        g.starred = 20;
        assert_eq!(suggest(g, Utc::now()), None);
    }
}
