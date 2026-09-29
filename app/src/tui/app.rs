//! Screen state and what each key does. No drawing or I/O here, so it can be tested:
//! anything that touches the network, disk or keychain comes back as an [`Effect`].

use std::collections::HashSet;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::widgets::TableState;

use super::settings::{Settings, SettingsAction};
use super::setup::{Setup, SetupAction};
use super::worker::{Job, Scan, Update};
use crate::config::Config;
use crate::journal::Batch;
use crate::senders::{SenderGroup, SortBy};

pub enum Mode {
    Setup,
    Scanning,
    Board,
    Confirm,
    ConfirmUndo(Batch),
    Working,
    Help,
    Settings,
}

/// Work the event loop does on the app's behalf
pub enum Effect {
    Job(Job),
    /// Start a mail connection for this account
    Connect {
        config: Config,
        password: String,
    },
    SaveSettings(Config),
    StorePassword {
        username: String,
        password: String,
    },
    ForgetPassword(String),
}

pub struct Progress {
    pub stage: &'static str,
    pub done: usize,
    pub total: usize,
}

pub struct App {
    pub mode: Mode,
    pub config: Config,
    pub dry_run: bool,
    pub demo: bool,
    pub password_saved: bool,
    pub setup: Setup,
    pub settings: Settings,
    /// Set while a setup connection is in flight: the password to keep if it works
    pending: Option<Pending>,
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

struct Pending {
    password: String,
    remember: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Info,
    Good,
    Warn,
}

impl App {
    /// Start connected (a saved account and password were found)
    pub fn connected(
        config: Config,
        password_saved: bool,
        dry_run: bool,
        demo: bool,
        last: Option<Batch>,
    ) -> Self {
        let mut app = Self::blank(config, dry_run, demo, last);
        app.password_saved = password_saved;
        app.mode = Mode::Scanning;
        app
    }

    /// Start on the setup screen
    pub fn needs_setup(
        setup: Setup,
        config: Option<Config>,
        dry_run: bool,
        last: Option<Batch>,
    ) -> Self {
        let config = config
            .unwrap_or_else(|| Config::new_account("", 993, "", crate::config::Security::Tls));
        let mut app = Self::blank(config, dry_run, false, last);
        app.setup = setup;
        app.mode = Mode::Setup;
        app
    }

    fn blank(config: Config, dry_run: bool, demo: bool, last_batch: Option<Batch>) -> Self {
        Self {
            mode: Mode::Scanning,
            config,
            dry_run,
            demo,
            password_saved: false,
            setup: Setup::new(None),
            settings: Settings::open(),
            pending: None,
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

    pub fn account(&self) -> &str {
        if self.demo {
            "demo@killall.email"
        } else {
            &self.config.account.username
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

    fn scan(&mut self, stage: &'static str) -> Effect {
        self.mode = Mode::Scanning;
        self.progress = Progress {
            stage,
            done: 0,
            total: 0,
        };
        Effect::Job(Job::Scan(self.config.safety.clone()))
    }

    pub fn on_update(&mut self, update: Update) -> Vec<Effect> {
        match update {
            Update::Connected => {
                let mut effects = Vec::new();
                if let Some(p) = self.pending.take() {
                    // A new account from setup worked: keep it
                    effects.push(Effect::SaveSettings(self.config.clone()));
                    if p.remember {
                        effects.push(Effect::StorePassword {
                            username: self.config.account.username.clone(),
                            password: p.password,
                        });
                    }
                    self.groups.clear();
                    self.last_batch = None;
                }
                effects.push(self.scan("Scanning"));
                effects
            }
            Update::ConnectFailed(e) => {
                let message = friendly_login_error(&e);
                if self.pending.take().is_some() || matches!(self.mode, Mode::Setup) {
                    self.setup.failed(message);
                } else {
                    // The saved password stopped working: ask again
                    self.setup = Setup::ask_password(self.config.clone(), Some(message));
                }
                self.mode = Mode::Setup;
                Vec::new()
            }
            Update::Progress { stage, done, total } => {
                self.progress = Progress { stage, done, total };
                Vec::new()
            }
            Update::Scanned(scan) => {
                self.load(scan);
                Vec::new()
            }
            Update::Terminated(t) => {
                self.terminated(t);
                Vec::new()
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
                vec![self.scan("Rescanning")]
            }
            Update::Failed(e) => {
                self.say(e, Tone::Warn);
                self.mode = if self.groups.is_empty() {
                    Mode::Scanning
                } else {
                    Mode::Board
                };
                Vec::new()
            }
        }
    }

    fn terminated(&mut self, t: crate::ops::Terminated) {
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
        if t.dry_run {
            self.marked.clear();
        } else {
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
        }
        self.mode = Mode::Board;
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

    pub fn say(&mut self, text: impl Into<String>, tone: Tone) {
        self.status = Some((text.into(), tone));
    }

    pub fn on_paste(&mut self, text: &str) {
        match self.mode {
            Mode::Setup => self.setup.paste(text),
            Mode::Settings => self.settings.paste(text),
            _ => {}
        }
    }

    /// Handle a key; returns work for the event loop
    pub fn on_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.quit = true;
            return Vec::new();
        }
        match self.mode {
            Mode::Setup => self.on_setup_key(key),
            Mode::Settings => self.on_settings_key(key),
            Mode::Scanning | Mode::Working => {
                if matches!(key.code, KeyCode::Char('q') | KeyCode::Esc) {
                    self.quit = true;
                }
                Vec::new()
            }
            Mode::Help => {
                self.mode = Mode::Board;
                Vec::new()
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
                    vec![Effect::Job(Job::Terminate(groups))]
                }
                _ => {
                    self.mode = Mode::Board;
                    self.say("Cancelled. Nothing was moved", Tone::Info);
                    Vec::new()
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
                    vec![Effect::Job(Job::Undo(id))]
                }
                _ => {
                    self.mode = Mode::Board;
                    Vec::new()
                }
            },
            Mode::Board => self.on_board_key(key),
        }
    }

    fn on_setup_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        match self.setup.on_key(key) {
            SetupAction::None => Vec::new(),
            SetupAction::Cancel => {
                self.mode = if self.groups.is_empty() {
                    Mode::Scanning
                } else {
                    Mode::Board
                };
                Vec::new()
            }
            SetupAction::Connect {
                config,
                password,
                remember,
            } => {
                let config = *config;
                self.config = config.clone();
                self.pending = Some(Pending {
                    password: password.clone(),
                    remember,
                });
                vec![Effect::Connect { config, password }]
            }
        }
    }

    fn on_settings_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        match self.settings.on_key(key, &mut self.config) {
            SettingsAction::None => Vec::new(),
            SettingsAction::Close { changed } => {
                self.mode = Mode::Board;
                if !changed {
                    return Vec::new();
                }
                self.say("Settings saved", Tone::Good);
                let mut effects = Vec::new();
                if !self.demo {
                    effects.push(Effect::SaveSettings(self.config.clone()));
                }
                effects.push(self.scan("Rescanning with the new settings"));
                effects
            }
            SettingsAction::ChangeAccount => {
                if self.demo {
                    self.settings.note = Some("The demo inbox has no account to change.".into());
                    return Vec::new();
                }
                self.setup = Setup::new(Some(self.config.clone()));
                self.mode = Mode::Setup;
                Vec::new()
            }
            SettingsAction::ForgetPassword => {
                if !self.password_saved {
                    return Vec::new();
                }
                self.password_saved = false;
                self.settings.note = Some("Forgotten. You'll be asked for it next time.".into());
                vec![Effect::ForgetPassword(self.config.account.username.clone())]
            }
        }
    }

    fn on_board_key(&mut self, key: KeyEvent) -> Vec<Effect> {
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
            KeyCode::Char('r') => return vec![self.scan("Rescanning")],
            KeyCode::Char(',') => {
                self.settings = Settings::open();
                self.mode = Mode::Settings;
            }
            KeyCode::Char('?') => self.mode = Mode::Help,
            _ => {}
        }
        Vec::new()
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
            Some(g) if g.protected.is_some() => format!(
                "{} is protected: {}",
                g.address,
                g.protected.map(|h| h.label()).unwrap_or("")
            ),
            Some(g) if g.targets.is_empty() => {
                format!("Everything from {} is protected", g.address)
            }
            _ => "Mark senders with space first".into(),
        }
    }
}

/// Server errors are terse; say what to do about the common ones
fn friendly_login_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("login failed")
        || lower.contains("authenticationfailed")
        || lower.contains("invalid credentials")
    {
        "That address and password didn't work. Most providers need an app password here, not your normal password.".into()
    } else if lower.contains("could not connect")
        || lower.contains("dns")
        || lower.contains("resolve")
    {
        format!(
            "Couldn't reach the mail server. Check your connection and the server name. ({raw})"
        )
    } else {
        raw.to_string()
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use crossterm::event::KeyEvent;

    use super::*;
    use crate::config::{Safety, Security};
    use crate::mail::{FakeStore, MailStore};
    use crate::safety::SafetyRules;
    use crate::senders::group_by_sender;
    use crate::tui::setup::Step;

    fn config() -> Config {
        Config::new_account("imap.gmail.com", 993, "me@gmail.com", Security::Tls)
    }

    fn loaded() -> App {
        let mut store = FakeStore::demo();
        let folders = store.folders().unwrap();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let rules = SafetyRules::new(&Safety::default(), store.sent_to.clone(), Utc::now());
        let mut app = App::connected(config(), true, false, false, None);
        app.on_update(Update::Scanned(Scan {
            folders,
            groups: group_by_sender(&msgs, &rules),
            messages: msgs.len(),
            correspondents: 2,
        }));
        app
    }

    fn press(app: &mut App, code: KeyCode) -> Vec<Effect> {
        app.on_key(KeyEvent::from(code))
    }

    #[test]
    fn marking_and_confirming_sends_the_marked_senders() {
        let mut app = loaded();
        press(&mut app, KeyCode::Char(' '));
        press(&mut app, KeyCode::Char(' '));
        assert_eq!(app.marked.len(), 2);
        assert!(press(&mut app, KeyCode::Char('d')).is_empty());
        assert!(matches!(app.mode, Mode::Confirm));
        match press(&mut app, KeyCode::Char('y')).pop() {
            Some(Effect::Job(Job::Terminate(groups))) => assert_eq!(groups.len(), 2),
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
        press(&mut app, KeyCode::Char(' '));
        assert!(app.marked.is_empty());
        press(&mut app, KeyCode::Char('d'));
        assert!(matches!(app.mode, Mode::Board), "nothing to confirm");
    }

    #[test]
    fn cancelling_moves_nothing() {
        let mut app = loaded();
        press(&mut app, KeyCode::Char('d'));
        assert!(matches!(app.mode, Mode::Confirm));
        assert!(press(&mut app, KeyCode::Char('n')).is_empty());
        assert!(matches!(app.mode, Mode::Board));
    }

    #[test]
    fn successful_setup_saves_settings_password_and_scans() {
        let mut app = App::needs_setup(Setup::new(None), None, false, None);
        press(&mut app, KeyCode::Enter); // Gmail
        for c in "me@gmail.com".chars() {
            press(&mut app, KeyCode::Char(c));
        }
        press(&mut app, KeyCode::Tab);
        app.on_paste("app-password");
        let effects = press(&mut app, KeyCode::Enter);
        assert!(matches!(effects.as_slice(), [Effect::Connect { .. }]));

        let effects = app.on_update(Update::Connected);
        assert!(
            matches!(effects[0], Effect::SaveSettings(ref c) if c.account.username == "me@gmail.com")
        );
        assert!(
            matches!(effects[1], Effect::StorePassword { ref password, .. } if password == "app-password")
        );
        assert!(matches!(effects[2], Effect::Job(Job::Scan(_))));
        assert!(matches!(app.mode, Mode::Scanning));
    }

    #[test]
    fn failed_login_returns_to_the_password() {
        let mut app = App::needs_setup(Setup::new(None), None, false, None);
        press(&mut app, KeyCode::Enter);
        for c in "me@gmail.com".chars() {
            press(&mut app, KeyCode::Char(c));
        }
        press(&mut app, KeyCode::Tab);
        app.on_paste("wrong");
        press(&mut app, KeyCode::Enter);
        app.on_update(Update::ConnectFailed(
            "login failed for me@gmail.com: no".into(),
        ));
        assert!(matches!(app.mode, Mode::Setup));
        assert_eq!(app.setup.step, Step::Form);
        assert!(app.setup.error.as_deref().unwrap().contains("app password"));
    }

    #[test]
    fn a_stale_saved_password_asks_again() {
        let mut app = App::connected(config(), true, false, false, None);
        app.on_update(Update::ConnectFailed("login failed".into()));
        assert!(matches!(app.mode, Mode::Setup));
        assert_eq!(app.setup.step, Step::Form);
    }

    #[test]
    fn changed_settings_are_saved_and_rescanned() {
        let mut app = loaded();
        press(&mut app, KeyCode::Char(','));
        assert!(matches!(app.mode, Mode::Settings));
        press(&mut app, KeyCode::Down);
        press(&mut app, KeyCode::Right);
        let effects = press(&mut app, KeyCode::Esc);
        assert_eq!(app.config.safety.recent_days, 30);
        assert!(matches!(effects[0], Effect::SaveSettings(ref c) if c.safety.recent_days == 30));
        assert!(matches!(effects[1], Effect::Job(Job::Scan(ref s)) if s.recent_days == 30));
    }
}
