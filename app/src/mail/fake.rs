//! In-memory [`MailStore`] used by tests and `--demo`.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Result, bail};
use chrono::{Duration, Utc};

use super::{Folders, MailStore, MessageMeta, Unsubscribe};

#[derive(Default)]
pub struct FakeStore {
    pub folders: BTreeMap<String, Vec<MessageMeta>>,
    pub sent_to: HashSet<String>,
    next_uid: u32,
}

impl FakeStore {
    pub fn new() -> Self {
        let mut s = Self {
            next_uid: 1,
            ..Default::default()
        };
        for f in ["INBOX", "Trash", "Sent"] {
            s.folders.insert(f.into(), Vec::new());
        }
        s
    }

    pub fn add(&mut self, folder: &str, mut meta: MessageMeta) -> u32 {
        meta.uid = self.next_uid;
        self.next_uid += 1;
        let uid = meta.uid;
        self.folders.entry(folder.into()).or_default().push(meta);
        uid
    }

    pub fn count(&self, folder: &str) -> usize {
        self.folders.get(folder).map_or(0, Vec::len)
    }

    /// A believable inbox for the demo: a few loud bulk senders and some people
    pub fn demo() -> Self {
        let mut s = Self::new();
        let senders: &[(&str, &str, usize, u32, &str)] = &[
            ("notify@socialnet.example", "SocialNet", 214, 2, "1-click"),
            ("deals@shopmart.example", "ShopMart", 171, 5, "1-click"),
            (
                "digest@dailybrief.example",
                "The Daily Brief",
                96,
                30,
                "mailto",
            ),
            ("no-reply@rideshare.example", "RideShare", 58, 12, "1-click"),
            ("alerts@bank-promos.example", "Bank Offers", 34, 20, "web"),
            ("news@oldforum.example", "Old Forum", 27, 0, "none"),
            ("mom@family.example", "Mom", 41, 98, "none"),
            ("boss@work.example", "Dana (Work)", 19, 100, "none"),
        ];
        for (n, &(from, name, count, open_pct, unsub)) in senders.iter().enumerate() {
            for i in 0..count {
                let domain = from.split('@').nth(1).unwrap_or("example");
                let bulk = unsub != "none" || from.starts_with("news@");
                let seen = (i as u32 * 100) < open_pct * count as u32;
                let unsubscribe = match unsub {
                    "1-click" => Unsubscribe {
                        https: Some(format!("https://{domain}/unsubscribe")),
                        mailto: None,
                        one_click: true,
                    },
                    "mailto" => Unsubscribe {
                        https: None,
                        mailto: Some(format!("mailto:leave@{domain}")),
                        one_click: false,
                    },
                    "web" => Unsubscribe {
                        https: Some(format!("https://{domain}/prefs")),
                        mailto: None,
                        one_click: false,
                    },
                    _ => Unsubscribe::default(),
                };
                s.add(
                    "INBOX",
                    MessageMeta {
                        uid: 0,
                        message_id: Some(format!("{i}.{from}")),
                        from: from.into(),
                        from_name: Some(name.into()),
                        subject: format!("{name} update #{i}"),
                        date: Some(
                            Utc::now() - Duration::days(n as i64 * 11 + (i as i64 * 3) % 700),
                        ),
                        seen,
                        flagged: from.starts_with("deals@") && i == 3,
                        answered: from.starts_with("mom@") && i % 5 == 0,
                        size: 18_000 + (i as u32 % 7) * 4_000,
                        unsubscribe,
                        bulk,
                    },
                );
            }
        }
        s.sent_to.insert("mom@family.example".into());
        s.sent_to.insert("boss@work.example".into());
        s
    }
}

impl MailStore for FakeStore {
    fn folders(&mut self) -> Result<Folders> {
        Ok(Folders {
            inbox: "INBOX".into(),
            trash: "Trash".into(),
            sent: Some("Sent".into()),
        })
    }

    fn scan(
        &mut self,
        folder: &str,
        limit: usize,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<Vec<MessageMeta>> {
        let mut out = self.folders.get(folder).cloned().unwrap_or_default();
        out.sort_by(|a, b| b.uid.cmp(&a.uid));
        if limit > 0 {
            out.truncate(limit);
        }
        progress(out.len(), out.len());
        Ok(out)
    }

    fn sent_recipients(&mut self, _folder: &str, _limit: usize) -> Result<HashSet<String>> {
        Ok(self.sent_to.clone())
    }

    fn move_messages(&mut self, from: &str, uids: &[u32], to: &str) -> Result<()> {
        let Some(source) = self.folders.get_mut(from) else {
            bail!("no folder {from}");
        };
        let (moving, keep): (Vec<_>, Vec<_>) =
            source.drain(..).partition(|m| uids.contains(&m.uid));
        *source = keep;
        for m in moving {
            // A move gives the message a new UID in the destination, as on a real server
            self.add(to, m);
        }
        Ok(())
    }

    fn find_by_message_id(&mut self, folder: &str, message_id: &str) -> Result<Option<u32>> {
        Ok(self.folders.get(folder).and_then(|msgs| {
            msgs.iter()
                .filter(|m| m.message_id.as_deref() == Some(message_id))
                .map(|m| m.uid)
                .max()
        }))
    }
}
