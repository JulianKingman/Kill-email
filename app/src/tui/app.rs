//! Screen state and what each key does. No drawing or I/O here, so it can be tested.

use std::collections::HashSet;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::widgets::TableState;

use super::worker::{Job, Scan, Update};
use crate::journal::Batch;
use crate::senders::{SenderGroup, SortBy};

pub enum Mode {
    Scanning,
    Board,
    Confirm,
    ConfirmUndo(Batch),
    Working,
    Help,
}

pub struct Progress {
    pub stage: &'static str,
    pub done: usize,
    pub total: usize,
}

pub struct App {
    pub mode: Mode,
    pub account: String,
    pub dry_run: bool,
    pub demo: bool,
    pub folder: String,
    pub groups: Vec<SenderGroup>,
    pub table: TableState,
    pub marked: HashSet<String>,
    pub sort: SortBy,
    pub progress: Progress,
    pub messages: usize,
    pub correspondents: usize,
    pub status: Option<(String, Tone)>,
    /// Newest batch that can still be undone
    pub last_batch: Option<Batch>,
    pub quit: bool,
    /// Animation clock for the marching robots
    pub tick: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Info,
    Good,
    Warn,
}

impl App {
    pub fn new(account: String, dry_run: bool, demo: bool, last_batch: Option<Batch>) -> Self {
        Self {
            mode: Mode::Scanning,
            account,
            dry_run,
            demo,
            folder: "INBOX".into(),
            groups: Vec::new(),
            table: TableState::default(),
            marked: HashSet::new(),
            sort: SortBy::Volume,
            progress: Progress {
                stage: "Connecting",
                done: 0,
                total: 0,
            },
            messages: 0,
            correspondents: 0,
            status: None,
            last_batch,
            quit: false,
            tick: 0,
        }
    }

    pub fn selected(&self) -> Option<&SenderGroup> {
        self.table.selected().and_then(|i| self.groups.get(i))
    }

    /// Senders the next Terminate acts on: the marked ones, or the highlighted one
    pub fn chosen(&self) -> Vec<&SenderGroup> {
        if self.marked.is_empty() {
            self.selected()
                .filter(|g| g.protected.is_none() && !g.targets.is_empty())
                .into_iter()
                .collect()
        } else {
            self.groups
                .iter()
                .filter(|g| self.marked.contains(&g.address))
                .collect()
        }
    }

    pub fn chosen_totals(&self) -> (usize, usize, u64) {
        let chosen = self.chosen();
        let messages = chosen.iter().map(|g| g.targets.len()).sum();
        let bytes = chosen
            .iter()
            .map(|g| {
                if g.total == 0 {
                    0
                } else {
                    g.bytes * g.targets.len() as u64 / g.total as u64
                }
            })
            .sum();
        (chosen.len(), messages, bytes)
    }

    pub fn on_update(&mut self, update: Update) {
        match update {
            Update::Progress { stage, done, total } => {
                self.progress = Progress { stage, done, total };
            }
            Update::Scanned(scan) => self.load(scan),
            Update::Terminated(t) => {
                let verb = if t.dry_run {
                    "Would terminate"
                } else {
                    "Terminated"
                };
                let tail = if t.dry_run {
                    " (dry run: nothing moved)"
                } else {
                    ". Press u to undo"
                };
                let senders = if t.senders == 1 { "sender" } else { "senders" };
                self.say(
                    format!(
                        "{verb} {} messages from {} {senders}{tail}",
                        t.messages, t.senders
                    ),
                    Tone::Good,
                );
                if !t.dry_run {
                    let chosen: HashSet<String> = std::mem::take(&mut self.marked);
                    let current = self.selected().map(|g| g.address.clone());
                    for g in &mut self.groups {
                        if chosen.contains(&g.address)
                            || (chosen.is_empty() && Some(&g.address) == current.as_ref())
                        {
                            g.total -= g.targets.len();
                            g.unread = g.unread.min(g.total);
                            g.targets.clear();
                        }
                    }
                    self.last_batch = Some(Batch {
                        id: t.batch,
                        at: chrono::Utc::now(),
                        messages: t.messages,
                        senders: Vec::new(),
                        undone: false,
                    });
                } else {
                    self.marked.clear();
                }
                self.mode = Mode::Board;
            }
            Update::Undone(r) => {
                let missing = if r.missing > 0 {
                    format!(" ({} were no longer in Trash)", r.missing)
                } else {
                    String::new()
                };
                self.say(
                    format!("Restored {} messages{missing}. Rescanning", r.restored),
                    Tone::Good,
                );
                self.last_batch = None;
                self.mode = Mode::Scanning;
            }
            Update::Failed(e) => {
                self.say(e, Tone::Warn);
                self.mode = if self.groups.is_empty() {
                    Mode::Scanning
                } else {
                    Mode::Board
                };
            }
        }
    }

    fn load(&mut self, scan: Scan) {
        self.folder = scan.folders.inbox;
        self.messages = scan.messages;
        self.correspondents = scan.correspondents;
        self.groups = scan.groups;
        self.sort.apply(&mut self.groups);
        self.marked.clear();
        self.table.select(if self.groups.is_empty() {
            None
        } else {
            Some(0)
        });
        self.mode = Mode::Board;
    }

    fn say(&mut self, text: impl Into<String>, tone: Tone) {
        self.status = Some((text.into(), tone));
    }

    /// Handle a key; returns work for the mail thread when the key starts some
    pub fn on_key(&mut self, key: KeyEvent) -> Option<Job> {
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.quit = true;
            return None;
        }
        match self.mode {
            Mode::Scanning | Mode::Working => {
                if matches!(key.code, KeyCode::Char('q') | KeyCode::Esc) {
                    self.quit = true;
                }
                None
            }
            Mode::Help => {
                self.mode = Mode::Board;
                None
            }
            Mode::Confirm => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    let groups: Vec<SenderGroup> = self.chosen().into_iter().cloned().collect();
                    self.mode = Mode::Working;
                    self.progress = Progress {
                        stage: "Terminating",
                        done: 0,
                        total: 0,
                    };
                    Some(Job::Terminate(groups))
                }
                _ => {
                    self.mode = Mode::Board;
                    self.say("Cancelled. Nothing was moved", Tone::Info);
                    None
                }
            },
            Mode::ConfirmUndo(ref batch) => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    let id = batch.id.clone();
                    self.mode = Mode::Working;
                    self.progress = Progress {
                        stage: "Restoring",
                        done: 0,
                        total: 0,
                    };
                    Some(Job::Undo(id))
                }
                _ => {
                    self.mode = Mode::Board;
                    None
                }
            },
            Mode::Board => self.on_board_key(key),
        }
    }

    fn on_board_key(&mut self, key: KeyEvent) -> Option<Job> {
        let len = self.groups.len();
        let current = self.table.selected().unwrap_or(0);
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => self.quit = true,
            KeyCode::Down | KeyCode::Char('j') if len > 0 => {
                self.table.select(Some((current + 1).min(len - 1)))
            }
            KeyCode::Up | KeyCode::Char('k') if len > 0 => {
                self.table.select(Some(current.saturating_sub(1)))
            }
            KeyCode::PageDown if len > 0 => self.table.select(Some((current + 15).min(len - 1))),
            KeyCode::PageUp if len > 0 => self.table.select(Some(current.saturating_sub(15))),
            KeyCode::Home | KeyCode::Char('g') if len > 0 => self.table.select(Some(0)),
            KeyCode::End | KeyCode::Char('G') if len > 0 => self.table.select(Some(len - 1)),
            KeyCode::Char(' ') => self.toggle_mark(),
            KeyCode::Char('s') => {
                let selected = self.selected().map(|g| g.address.clone());
                self.sort = self.sort.next();
                self.sort.apply(&mut self.groups);
                let idx = selected.and_then(|a| self.groups.iter().position(|g| g.address == a));
                self.table.select(idx.or(Some(0)));
                self.say(format!("Sorted by {}", self.sort.label()), Tone::Info);
            }
            KeyCode::Enter | KeyCode::Char('d') | KeyCode::Char('x') => {
                let (_, messages, _) = self.chosen_totals();
                if messages == 0 {
                    self.say(self.nothing_to_do_reason(), Tone::Warn);
                } else {
                    self.mode = Mode::Confirm;
                }
            }
            KeyCode::Char('u') => match self.last_batch.clone() {
                Some(b) if !b.undone => self.mode = Mode::ConfirmUndo(b),
                _ => self.say("Nothing to undo", Tone::Info),
            },
            KeyCode::Char('r') => {
                self.mode = Mode::Scanning;
                self.progress = Progress {
                    stage: "Rescanning",
                    done: 0,
                    total: 0,
                };
                return Some(Job::Scan);
            }
            KeyCode::Char('?') => self.mode = Mode::Help,
            _ => {}
        }
        None
    }

    fn toggle_mark(&mut self) {
        let Some(g) = self.selected() else { return };
        let address = g.address.clone();
        if let Some(hold) = g.protected {
            self.say(
                format!("{address} is protected: {}", hold.label()),
                Tone::Warn,
            );
            return;
        }
        if g.targets.is_empty() {
            self.say(
                format!("Everything from {address} is protected"),
                Tone::Warn,
            );
            return;
        }
        if !self.marked.remove(&address) {
            self.marked.insert(address);
        }
        let len = self.groups.len();
        if let Some(i) = self.table.selected() {
            self.table.select(Some((i + 1).min(len.saturating_sub(1))));
        }
    }

    fn nothing_to_do_reason(&self) -> String {
        match self.selected() {
            Some(g) if g.protected.is_some() => {
                format!(
                    "{} is protected: {}",
                    g.address,
                    g.protected.map(|h| h.label()).unwrap_or("")
                )
            }
            Some(g) if g.targets.is_empty() => {
                format!("Everything from {} is protected", g.address)
            }
            _ => "Mark senders with space first".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use crossterm::event::KeyEvent;

    use super::*;
    use crate::config::Safety;
    use crate::mail::{FakeStore, MailStore};
    use crate::safety::SafetyRules;
    use crate::senders::group_by_sender;

    fn loaded() -> App {
        let mut store = FakeStore::demo();
        let folders = store.folders().unwrap();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let rules = SafetyRules::new(&Safety::default(), store.sent_to.clone(), Utc::now());
        let mut app = App::new("demo".into(), false, true, None);
        app.on_update(Update::Scanned(Scan {
            folders,
            groups: group_by_sender(&msgs, &rules),
            messages: msgs.len(),
            correspondents: 2,
        }));
        app
    }

    fn press(app: &mut App, c: char) -> Option<Job> {
        app.on_key(KeyEvent::from(KeyCode::Char(c)))
    }

    #[test]
    fn marking_and_confirming_sends_the_marked_senders() {
        let mut app = loaded();
        press(&mut app, ' ');
        press(&mut app, ' ');
        assert_eq!(app.marked.len(), 2);
        assert!(press(&mut app, 'd').is_none());
        assert!(matches!(app.mode, Mode::Confirm));
        match press(&mut app, 'y') {
            Some(Job::Terminate(groups)) => assert_eq!(groups.len(), 2),
            _ => panic!("expected a terminate job"),
        }
    }

    #[test]
    fn protected_senders_cannot_be_marked() {
        let mut app = loaded();
        let mom = app
            .groups
            .iter()
            .position(|g| g.address == "mom@family.example")
            .unwrap();
        app.table.select(Some(mom));
        press(&mut app, ' ');
        assert!(app.marked.is_empty());
        press(&mut app, 'd');
        assert!(matches!(app.mode, Mode::Board), "nothing to confirm");
    }

    #[test]
    fn cancelling_moves_nothing() {
        let mut app = loaded();
        press(&mut app, 'd');
        assert!(matches!(app.mode, Mode::Confirm));
        assert!(press(&mut app, 'n').is_none());
        assert!(matches!(app.mode, Mode::Board));
    }
}
