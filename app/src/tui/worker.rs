//! Mail work happens on its own thread so the screen never freezes.

use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use anyhow::Result;
use chrono::Utc;

use crate::config::Safety;
use crate::journal::{Journal, Record};
use crate::mail::{Folders, MailStore};
use crate::ops::{self, Restored, Terminated};
use crate::safety::SafetyRules;
use crate::senders::{SenderGroup, group_by_sender};
use crate::unsubscribe::{Channels, Method, Pretend, unsubscribe};

pub type StoreFactory = Box<dyn FnOnce() -> Result<Box<dyn MailStore>> + Send>;

pub enum Job {
    /// Scan with these safety rules (they may have changed in settings)
    Scan(Safety),
    Kill(Kill),
    Undo(String),
}

/// What to do to the marked senders
pub struct Kill {
    /// Move their mail to Trash
    pub trash: Vec<SenderGroup>,
    /// Unsubscribe from these
    pub unsubscribe: Vec<SenderGroup>,
}

pub struct Killed {
    pub terminated: Option<Terminated>,
    pub unsubscribed: Vec<Unsubscribed>,
}

pub struct Unsubscribed {
    pub sender: String,
    pub result: Result<Method, String>,
}

pub enum Update {
    Connected,
    Progress {
        stage: &'static str,
        done: usize,
        total: usize,
    },
    Scanned(Scan),
    Killed(Killed),
    Undone(Restored),
    Failed(String),
    /// Could not log in; the thread has stopped
    ConnectFailed(String),
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
        mut channels: Box<dyn Channels + Send>,
        journal: Journal,
        dry_run: bool,
    ) -> Self {
        let (job_tx, job_rx) = mpsc::channel::<Job>();
        let (tx, rx) = mpsc::channel::<Update>();
        thread::spawn(move || {
            let mut store = match make_store() {
                Ok(s) => s,
                Err(e) => {
                    let _ = tx.send(Update::ConnectFailed(format!("{e:#}")));
                    return;
                }
            };
            if tx.send(Update::Connected).is_err() {
                return;
            }
            let mut folders: Option<Folders> = None;
            for job in job_rx {
                let result = match job {
                    Job::Scan(safety) => scan(store.as_mut(), &safety, &journal, &tx).map(|s| {
                        folders = Some(s.folders.clone());
                        Update::Scanned(s)
                    }),
                    Job::Kill(kill) => match &folders {
                        Some(f) => run_kill(
                            store.as_mut(),
                            channels.as_mut(),
                            f,
                            kill,
                            &journal,
                            dry_run,
                            &tx,
                        )
                        .map(Update::Killed),
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

fn scan(
    store: &mut dyn MailStore,
    safety: &Safety,
    journal: &Journal,
    tx: &Sender<Update>,
) -> Result<Scan> {
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
    let mut groups = group_by_sender(&messages, &rules);
    let unsubscribed = journal.unsubscribed().unwrap_or_default();
    for g in &mut groups {
        g.unsubscribed = unsubscribed.get(&g.address).copied();
    }
    Ok(Scan {
        folders,
        groups,
        messages: messages.len(),
        correspondents: count,
    })
}

/// Unsubscribe first (it needs nothing from the mailbox), then move the mail to Trash
fn run_kill(
    store: &mut dyn MailStore,
    channels: &mut dyn Channels,
    folders: &Folders,
    kill: Kill,
    journal: &Journal,
    dry_run: bool,
    tx: &Sender<Update>,
) -> Result<Killed> {
    let mut unsubscribed = Vec::new();
    {
        let leaving: Vec<&SenderGroup> = kill
            .unsubscribe
            .iter()
            .filter(|g| g.unsubscribed.is_none() && !g.unsubscribe.is_empty())
            .collect();
        for (i, g) in leaving.iter().enumerate() {
            let _ = tx.send(Update::Progress {
                stage: "Unsubscribing",
                done: i,
                total: leaving.len(),
            });
            let result = if dry_run {
                unsubscribe(&g.unsubscribe, &mut Pretend::default())
            } else {
                unsubscribe(&g.unsubscribe, channels)
            };
            if let (Ok(method), false) = (&result, dry_run) {
                journal.append(&[Record::Unsubscribed {
                    sender: g.address.clone(),
                    at: Utc::now(),
                    method: format!("{method:?}"),
                }])?;
            }
            unsubscribed.push(Unsubscribed {
                sender: g.address.clone(),
                result: result.map_err(|e| format!("{e:#}")),
            });
        }
    }

    let terminated = if !kill.trash.is_empty() {
        let groups: Vec<SenderGroup> = kill
            .trash
            .into_iter()
            .filter(|g| g.protected.is_none() && !g.targets.is_empty())
            .collect();
        let mut report = |done, total| {
            let _ = tx.send(Update::Progress {
                stage: "Terminating",
                done,
                total,
            });
        };
        Some(ops::terminate(
            store,
            folders,
            &groups,
            journal,
            dry_run,
            &mut report,
        )?)
    } else {
        None
    };
    Ok(Killed {
        terminated,
        unsubscribed,
    })
}
