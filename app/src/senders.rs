//! Group a scanned mailbox by sender: the Kill List.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Utc};

use crate::mail::{MessageMeta, Unsubscribe};
use crate::safety::{Hold, SafetyRules};

#[derive(Debug, Clone)]
pub struct SenderGroup {
    pub address: String,
    pub name: Option<String>,
    pub total: usize,
    pub unread: usize,
    pub bytes: u64,
    pub newest: Option<DateTime<Utc>>,
    pub oldest: Option<DateTime<Utc>>,
    /// Best unsubscribe method seen across this sender's messages
    pub unsubscribe: Unsubscribe,
    pub bulk: bool,
    /// Set when the whole sender is protected
    pub protected: Option<Hold>,
    /// Messages that would be moved to Trash, with their Message-IDs for undo
    pub targets: Vec<Target>,
    /// Messages kept despite targeting the sender, by reason
    pub held: BTreeMap<Hold, usize>,
    /// The newest few messages, so you can see what this sender sends
    pub samples: Vec<Sample>,
    /// Messages moved to Trash since the last scan
    pub trashed: usize,
    /// Set once you've unsubscribed from this sender
    pub unsubscribed: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sample {
    pub uid: u32,
    pub subject: String,
    pub date: Option<DateTime<Utc>>,
    pub seen: bool,
}

/// How many recent messages each sender keeps for the detail pane
pub const SAMPLES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub uid: u32,
    pub message_id: String,
}

impl SenderGroup {
    pub fn read_pct(&self) -> u32 {
        if self.total == 0 {
            return 0;
        }
        ((self.total - self.unread) * 100 / self.total) as u32
    }

    pub fn held_total(&self) -> usize {
        self.held.values().sum()
    }

    pub fn display_name(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.address)
    }
}

pub fn group_by_sender(messages: &[MessageMeta], rules: &SafetyRules) -> Vec<SenderGroup> {
    let mut groups: HashMap<&str, SenderGroup> = HashMap::new();

    for m in messages {
        let key = if m.from.is_empty() {
            "(unknown sender)"
        } else {
            m.from.as_str()
        };
        let g = groups.entry(key).or_insert_with(|| SenderGroup {
            address: key.to_string(),
            name: None,
            total: 0,
            unread: 0,
            bytes: 0,
            newest: None,
            oldest: None,
            unsubscribe: Unsubscribe::default(),
            bulk: false,
            protected: rules.sender_hold(key),
            targets: Vec::new(),
            held: BTreeMap::new(),
            samples: Vec::new(),
            trashed: 0,
            unsubscribed: None,
        });

        g.total += 1;
        g.unread += usize::from(!m.seen);
        g.bytes += u64::from(m.size);
        g.bulk |= m.bulk;
        if g.name.is_none() {
            g.name = m.from_name.clone();
        }
        if m.unsubscribe.rank() > g.unsubscribe.rank() {
            g.unsubscribe = m.unsubscribe.clone();
        }
        if let Some(d) = m.date {
            g.newest = Some(g.newest.map_or(d, |n| n.max(d)));
            g.oldest = Some(g.oldest.map_or(d, |o| o.min(d)));
        }

        g.samples.push(Sample {
            uid: m.uid,
            subject: m.subject.clone(),
            date: m.date,
            seen: m.seen,
        });
        if g.samples.len() > SAMPLES * 4 {
            trim_samples(&mut g.samples);
        }

        if g.protected.is_some() {
            continue;
        }
        match rules.message_hold(m) {
            Some(hold) => *g.held.entry(hold).or_default() += 1,
            None => g.targets.push(Target {
                uid: m.uid,
                // message_hold guarantees an ID for anything it lets through
                message_id: m.message_id.clone().unwrap_or_default(),
            }),
        }
    }

    let mut out: Vec<SenderGroup> = groups.into_values().collect();
    for g in &mut out {
        trim_samples(&mut g.samples);
    }
    out.sort_by(|a, b| {
        b.total
            .cmp(&a.total)
            .then_with(|| a.address.cmp(&b.address))
    });
    out
}

/// Keep only the newest samples, newest first
fn trim_samples(samples: &mut Vec<Sample>) {
    samples.sort_by_key(|s| std::cmp::Reverse(s.date));
    samples.truncate(SAMPLES);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortBy {
    Volume,
    LeastRead,
    Oldest,
}

impl SortBy {
    pub fn next(self) -> Self {
        match self {
            SortBy::Volume => SortBy::LeastRead,
            SortBy::LeastRead => SortBy::Oldest,
            SortBy::Oldest => SortBy::Volume,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            SortBy::Volume => "most mail",
            SortBy::LeastRead => "least read",
            SortBy::Oldest => "oldest",
        }
    }

    pub fn apply(self, groups: &mut [SenderGroup]) {
        match self {
            SortBy::Volume => groups.sort_by_key(|g| std::cmp::Reverse(g.total)),
            SortBy::LeastRead => groups.sort_by(|a, b| {
                a.read_pct()
                    .cmp(&b.read_pct())
                    .then_with(|| b.total.cmp(&a.total))
            }),
            SortBy::Oldest => groups.sort_by_key(|a| a.newest),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::config::Safety;
    use crate::mail::{FakeStore, MailStore};

    #[test]
    fn demo_inbox_groups_and_protects() {
        let mut store = FakeStore::demo();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let sent = store.sent_recipients("Sent", 0).unwrap();
        let rules = SafetyRules::new(&Safety::default(), sent, Utc::now());
        let groups = group_by_sender(&msgs, &rules);

        assert_eq!(groups[0].address, "notify@socialnet.example");
        assert_eq!(groups[0].total, 214);
        assert_eq!(groups[0].unsubscribe.label(), "1-click");
        let samples = &groups[0].samples;
        assert_eq!(samples.len(), SAMPLES);
        assert!(samples.windows(2).all(|w| w[0].date >= w[1].date));
        assert!(!samples[0].subject.is_empty());

        let mom = groups
            .iter()
            .find(|g| g.address == "mom@family.example")
            .unwrap();
        assert_eq!(mom.protected, Some(Hold::Correspondent));
        assert!(mom.targets.is_empty());

        let shop = groups
            .iter()
            .find(|g| g.address == "deals@shopmart.example")
            .unwrap();
        assert_eq!(shop.held.get(&Hold::Flagged), Some(&1));
        assert!(shop.held.contains_key(&Hold::Recent));
        assert_eq!(shop.targets.len() + shop.held_total(), shop.total);
        // Nothing protected ever lands in the target list
        let target_uids: HashSet<u32> = shop.targets.iter().map(|t| t.uid).collect();
        for m in msgs.iter().filter(|m| m.from == shop.address) {
            if rules.message_hold(m).is_some() {
                assert!(!target_uids.contains(&m.uid));
            }
        }
    }
}
