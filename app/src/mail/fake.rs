//! In-memory [`MailStore`] used by tests and `--demo`.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Result, bail};
use chrono::{Duration, Utc};

use super::kind::{Signals, classify};
use super::{Folders, MailStore, MessageMeta, Unsubscribe};

#[derive(Default)]
pub struct FakeStore {
    pub folders: BTreeMap<String, Vec<MessageMeta>>,
    pub sent_to: HashSet<String>,
    next_uid: u32,
}

/// (address, name, count, % opened, unsubscribe method, subjects)
type DemoSender = (
    &'static str,
    &'static str,
    usize,
    u32,
    &'static str,
    &'static [&'static str],
);

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

    /// A believable inbox for the demo: loud bulk senders of each kind, and some people
    pub fn demo() -> Self {
        let mut s = Self::new();
        let senders: &[DemoSender] = &[
            (
                "notify@socialnet.example",
                "SocialNet",
                214,
                2,
                "1-click",
                &[
                    "Alex liked your photo",
                    "Sam commented on your post",
                    "People you may know",
                    "You have a new follower",
                ],
            ),
            (
                "deals@shopmart.example",
                "ShopMart",
                171,
                5,
                "klaviyo",
                &[
                    "40% off everything this weekend",
                    "Last chance: free shipping ends tonight",
                    "New arrivals just dropped",
                ],
            ),
            (
                "notifications@github.com",
                "GitHub",
                120,
                35,
                "1-click",
                &[
                    "Re: [acme/api] Fix login redirect (PR #{})",
                    "[acme/web] Build failed on main",
                    "Re: [acme/api] Review requested (#{})",
                ],
            ),
            (
                "digest@dailybrief.example",
                "The Daily Brief",
                96,
                30,
                "mailto",
                &["The Daily Brief: issue #{}"],
            ),
            (
                "no-reply@rideshare.example",
                "RideShare",
                58,
                4,
                "1-click",
                &["Your Tuesday evening trip receipt", "Your ride receipt"],
            ),
            (
                "alerts@bank-promos.example",
                "Bank Offers",
                34,
                0,
                "web",
                &[
                    "Exclusive offer: 0% intro APR",
                    "Don't miss your pre-approved card",
                ],
            ),
            (
                "news@oldforum.example",
                "Old Forum",
                27,
                0,
                "none",
                &["This week in the forum"],
            ),
            (
                "mom@family.example",
                "Mom",
                41,
                98,
                "none",
                &["dinner sunday?", "photos from the trip"],
            ),
            (
                "boss@work.example",
                "Dana (Work)",
                19,
                100,
                "none",
                &["Q3 plan", "quick question"],
            ),
        ];
        for (n, &(from, name, count, open_pct, unsub, subjects)) in senders.iter().enumerate() {
            let domain = from.split('@').nth(1).unwrap_or("example");
            let unsubscribe = match unsub {
                "1-click" => Unsubscribe {
                    https: Some(format!("https://{domain}/unsubscribe")),
                    mailto: None,
                    one_click: true,
                },
                "klaviyo" => Unsubscribe {
                    https: Some("https://ctrk.klclick.com/u?list=shopmart".into()),
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
            let bulk = unsub != "none" || from.starts_with("news@");
            let present: &[&str] = if domain == "github.com" {
                &["X-GitHub-Reason"]
            } else {
                &[]
            };
            for i in 0..count {
                let subject = subjects[i % subjects.len()].replace("{}", &(900 - i).to_string());
                let (kind, platform) = classify(&Signals {
                    from,
                    subject: &subject,
                    bulk,
                    list_unsubscribe: unsubscribe.https.as_deref(),
                    present,
                    ..Default::default()
                });
                // Mail you read is spread through a sender's history; mail you mostly
                // ignore you last opened long ago (i counts back from the newest)
                let seen = if open_pct >= 20 {
                    (i as u32 * open_pct) % 100 < open_pct
                } else {
                    ((count - 1 - i) as u32 * 100) < open_pct * count as u32
                };
                let meta = MessageMeta {
                    uid: 0,
                    message_id: Some(format!("{i}.{from}")),
                    from: from.into(),
                    from_name: Some(name.into()),
                    subject,
                    date: Some(Utc::now() - Duration::days(n as i64 * 11 + (i as i64 * 3) % 700)),
                    seen,
                    flagged: from.starts_with("deals@") && i == 3,
                    answered: from.starts_with("mom@") && i % 5 == 0,
                    size: 18_000 + (i as u32 % 7) * 4_000,
                    unsubscribe: unsubscribe.clone(),
                    bulk,
                    kind,
                    platform,
                };
                // Older shouting already binned unread
                let binned = match from {
                    "deals@shopmart.example" => i % 15 == 14,
                    "notify@socialnet.example" => i % 40 == 39,
                    _ => false,
                };
                if binned && !seen {
                    let mut old = meta.clone();
                    old.message_id = Some(format!("old{i}.{from}"));
                    old.date = old.date.map(|d| d - Duration::days(700));
                    s.add("Trash", old);
                }
                s.add("INBOX", meta);
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
        out.sort_by_key(|m| std::cmp::Reverse(m.uid));
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
