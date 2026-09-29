//! Moving mail to Trash and putting it back.

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use chrono::Utc;

use crate::journal::{Journal, Moved, Record};
use crate::mail::{Folders, MailStore};
use crate::senders::SenderGroup;

const CHUNK: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terminated {
    pub batch: String,
    pub messages: usize,
    pub senders: usize,
    /// How many messages each sender lost
    pub trashed: Vec<(String, usize)>,
    pub dry_run: bool,
}

/// Move every target message from these senders to Trash, journaling each chunk as it goes.
/// If a move fails partway, what already moved stays journaled and can still be undone.
pub fn terminate(
    store: &mut dyn MailStore,
    folders: &Folders,
    groups: &[SenderGroup],
    journal: &Journal,
    dry_run: bool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Terminated> {
    let batch = Utc::now().format("%Y%m%d-%H%M%S%.3f").to_string();
    let total: usize = groups.iter().map(|g| g.targets.len()).sum();
    let mut done = 0;
    progress(0, total);

    for g in groups {
        if g.protected.is_some() {
            bail!("{} is protected and can't be deleted", g.address);
        }
        if dry_run {
            done += g.targets.len();
            progress(done, total);
            continue;
        }
        for chunk in g.targets.chunks(CHUNK) {
            let uids: Vec<u32> = chunk.iter().map(|t| t.uid).collect();
            store.move_messages(&folders.inbox, &uids, &folders.trash)?;
            let at = Utc::now();
            let records: Vec<Record> = chunk
                .iter()
                .map(|t| {
                    Record::Moved(Moved {
                        batch: batch.clone(),
                        at,
                        sender: g.address.clone(),
                        message_id: t.message_id.clone(),
                        from: folders.inbox.clone(),
                        to: folders.trash.clone(),
                    })
                })
                .collect();
            journal.append(&records)?;
            done += chunk.len();
            progress(done, total);
        }
    }

    Ok(Terminated {
        batch,
        messages: total,
        senders: groups.len(),
        trashed: groups
            .iter()
            .map(|g| (g.address.clone(), g.targets.len()))
            .collect(),
        dry_run,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Restored {
    pub batch: String,
    pub restored: usize,
    /// Messages no longer in Trash, usually because the Trash was emptied
    pub missing: usize,
}

pub fn undo(store: &mut dyn MailStore, journal: &Journal, batch: &str) -> Result<Restored> {
    let moved = journal.moved_in(batch)?;
    if moved.is_empty() {
        bail!("no batch {batch} in the undo journal");
    }

    // Look each message up by Message-ID, since its UID changed when it moved
    let mut by_route: BTreeMap<(String, String), Vec<u32>> = BTreeMap::new();
    let mut missing = 0;
    for m in &moved {
        match store.find_by_message_id(&m.to, &m.message_id)? {
            Some(uid) => by_route
                .entry((m.to.clone(), m.from.clone()))
                .or_default()
                .push(uid),
            None => missing += 1,
        }
    }

    let mut restored = 0;
    for ((trash, back_to), mut uids) in by_route {
        uids.sort_unstable();
        uids.dedup();
        store.move_messages(&trash, &uids, &back_to)?;
        restored += uids.len();
    }
    journal.append(&[Record::Undone {
        batch: batch.to_string(),
        at: Utc::now(),
    }])?;
    Ok(Restored {
        batch: batch.to_string(),
        restored,
        missing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Safety;
    use crate::mail::FakeStore;
    use crate::safety::SafetyRules;
    use crate::senders::group_by_sender;

    fn setup() -> (FakeStore, Folders, Vec<SenderGroup>, Journal, tempdir::Dir) {
        let mut store = FakeStore::demo();
        let folders = store.folders().unwrap();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let sent = store.sent_recipients("Sent", 0).unwrap();
        let rules = SafetyRules::new(&Safety::default(), sent, Utc::now());
        let groups = group_by_sender(&msgs, &rules);
        let dir = tempdir::Dir::new();
        let journal = Journal::new(dir.path.join("journal.jsonl"));
        (store, folders, groups, journal, dir)
    }

    #[test]
    fn terminate_then_undo_round_trips() {
        let (mut store, folders, groups, journal, _dir) = setup();
        let inbox_before = store.count("INBOX");
        let trash_before = store.count("Trash");
        let shop: Vec<SenderGroup> = groups
            .into_iter()
            .filter(|g| g.address == "deals@shopmart.example")
            .collect();
        let targets = shop[0].targets.len();
        assert!(targets > 0);

        let out = terminate(&mut store, &folders, &shop, &journal, false, &mut |_, _| {}).unwrap();
        assert_eq!(out.messages, targets);
        assert_eq!(store.count("INBOX"), inbox_before - targets);
        assert_eq!(store.count("Trash"), trash_before + targets);

        let batches = journal.batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].messages, targets);
        assert!(!batches[0].undone);

        let back = undo(&mut store, &journal, &out.batch).unwrap();
        assert_eq!(back.restored, targets);
        assert_eq!(back.missing, 0);
        assert_eq!(store.count("INBOX"), inbox_before);
        assert_eq!(store.count("Trash"), trash_before);
        assert!(journal.batches().unwrap()[0].undone);
    }

    #[test]
    fn dry_run_moves_nothing() {
        let (mut store, folders, groups, journal, _dir) = setup();
        let before = store.count("INBOX");
        let out = terminate(
            &mut store,
            &folders,
            &groups[..1],
            &journal,
            true,
            &mut |_, _| {},
        )
        .unwrap();
        assert!(out.dry_run);
        assert_eq!(store.count("INBOX"), before);
        assert!(journal.batches().unwrap().is_empty());
    }

    #[test]
    fn protected_senders_are_refused() {
        let (mut store, folders, groups, journal, _dir) = setup();
        let mom: Vec<SenderGroup> = groups
            .into_iter()
            .filter(|g| g.address == "mom@family.example")
            .collect();
        assert!(terminate(&mut store, &folders, &mom, &journal, false, &mut |_, _| {}).is_err());
    }

    #[test]
    fn emptied_trash_is_reported_not_fatal() {
        let (mut store, folders, groups, journal, _dir) = setup();
        let first: Vec<SenderGroup> = groups.into_iter().take(1).collect();
        let out = terminate(
            &mut store,
            &folders,
            &first,
            &journal,
            false,
            &mut |_, _| {},
        )
        .unwrap();
        store.folders.get_mut("Trash").unwrap().clear();
        let back = undo(&mut store, &journal, &out.batch).unwrap();
        assert_eq!(back.restored, 0);
        assert_eq!(back.missing, out.messages);
    }

    /// Minimal temp dir so tests don't need another dependency
    mod tempdir {
        use std::path::PathBuf;

        pub struct Dir {
            pub path: PathBuf,
        }

        impl Dir {
            pub fn new() -> Self {
                let path = std::env::temp_dir().join(format!(
                    "kill-email-test-{}-{:?}",
                    std::process::id(),
                    std::thread::current().id()
                ));
                let _ = std::fs::remove_dir_all(&path);
                std::fs::create_dir_all(&path).unwrap();
                Self { path }
            }
        }

        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }
    }
}
