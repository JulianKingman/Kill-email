//! Mail work happens on its own thread so the screen never freezes.

use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use anyhow::Result;
use chrono::Utc;

use crate::config::Safety;
use crate::journal::Journal;
use crate::mail::{Folders, MailStore};
use crate::ops::{self, Restored, Terminated};
use crate::safety::SafetyRules;
use crate::senders::{SenderGroup, group_by_sender};

pub type StoreFactory = Box<dyn FnOnce() -> Result<Box<dyn MailStore>> + Send>;

pub enum Job {
    Scan,
    Terminate(Vec<SenderGroup>),
    Undo(String),
}

pub enum Update {
    Progress {
        stage: &'static str,
        done: usize,
        total: usize,
    },
    Scanned(Scan),
    Terminated(Terminated),
    Undone(Restored),
    Failed(String),
}

pub struct Scan {
    pub folders: Folders,
    pub groups: Vec<SenderGroup>,
    pub messages: usize,
    pub correspondents: usize,
}

pub struct Worker {
    pub jobs: Sender<Job>,
    pub updates: Receiver<Update>,
}

impl Worker {
    pub fn spawn(
        make_store: StoreFactory,
        safety: Safety,
        journal: Journal,
        dry_run: bool,
    ) -> Self {
        let (job_tx, job_rx) = mpsc::channel::<Job>();
        let (tx, rx) = mpsc::channel::<Update>();
        thread::spawn(move || {
            let mut store = match make_store() {
                Ok(s) => s,
                Err(e) => {
                    let _ = tx.send(Update::Failed(format!("{e:#}")));
                    return;
                }
            };
            let mut folders: Option<Folders> = None;
            for job in job_rx {
                let result = match job {
                    Job::Scan => scan(store.as_mut(), &safety, &tx).map(|s| {
                        folders = Some(s.folders.clone());
                        Update::Scanned(s)
                    }),
                    Job::Terminate(groups) => match &folders {
                        Some(f) => {
                            let mut report = |done, total| {
                                let _ = tx.send(Update::Progress {
                                    stage: "Terminating",
                                    done,
                                    total,
                                });
                            };
                            ops::terminate(
                                store.as_mut(),
                                f,
                                &groups,
                                &journal,
                                dry_run,
                                &mut report,
                            )
                            .map(Update::Terminated)
                        }
                        None => Err(anyhow::anyhow!("scan the mailbox first")),
                    },
                    Job::Undo(batch) => {
                        let _ = tx.send(Update::Progress {
                            stage: "Restoring",
                            done: 0,
                            total: 0,
                        });
                        ops::undo(store.as_mut(), &journal, &batch).map(Update::Undone)
                    }
                };
                let update = result.unwrap_or_else(|e| Update::Failed(format!("{e:#}")));
                if tx.send(update).is_err() {
                    break;
                }
            }
        });
        Worker {
            jobs: job_tx,
            updates: rx,
        }
    }
}

fn scan(store: &mut dyn MailStore, safety: &Safety, tx: &Sender<Update>) -> Result<Scan> {
    let folders = store.folders()?;

    let _ = tx.send(Update::Progress {
        stage: "Learning who you write to",
        done: 0,
        total: 0,
    });
    let correspondents = match &folders.sent {
        Some(sent) => store.sent_recipients(sent, safety.sent_scan_limit)?,
        None => Default::default(),
    };

    let mut report = |done, total| {
        let _ = tx.send(Update::Progress {
            stage: "Scanning",
            done,
            total,
        });
    };
    let messages = store.scan(&folders.inbox, safety.scan_limit, &mut report)?;

    let count = correspondents.len();
    let rules = SafetyRules::new(safety, correspondents, Utc::now());
    let groups = group_by_sender(&messages, &rules);
    Ok(Scan {
        folders,
        groups,
        messages: messages.len(),
        correspondents: count,
    })
}
