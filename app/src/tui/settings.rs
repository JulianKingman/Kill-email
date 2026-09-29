//! In-app settings. Everything a user can change lives here, not in a file.

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::{Constraint, Flex, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Clear, Paragraph, Wrap};

use super::input::Input;
use super::theme::{self, ALIVE, AMBER, BONE, PHOSPHOR, VOID};
use crate::config::{Config, IconSet};

const RECENT_DAYS: [u32; 7] = [3, 7, 14, 30, 60, 90, 180];
const SCAN_LIMITS: [usize; 6] = [0, 1_000, 5_000, 10_000, 25_000, 50_000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Item {
    Account,
    Recent,
    ScanLimit,
    Trusted,
    AutoLeave,
    Icons,
    Password,
}

const ITEMS: [Item; 7] = [
    Item::Account,
    Item::Recent,
    Item::ScanLimit,
    Item::Trusted,
    Item::AutoLeave,
    Item::Icons,
    Item::Password,
];

pub enum SettingsAction {
    None,
    /// Leave settings. `changed`: save them; `rescan`: the safety rules changed too
    Close {
        changed: bool,
        rescan: bool,
    },
    ChangeAccount,
    ForgetPassword,
}

#[derive(Default)]
pub struct Settings {
    selected: usize,
    /// Editing the trusted list: which entry is highlighted
    trusted: Option<usize>,
    /// A new trusted entry being typed
    adding: Option<Input>,
    /// Safety rules changed, so the scan is out of date
    changed: bool,
    /// Something that doesn't affect the scan changed
    prefs_changed: bool,
    pub note: Option<String>,
}

impl Settings {
    pub fn open() -> Self {
        Self::default()
    }

    pub fn paste(&mut self, text: &str) {
        if let Some(input) = &mut self.adding {
            input.paste(text.trim());
        }
    }

    pub fn on_key(&mut self, key: KeyEvent, config: &mut Config) -> SettingsAction {
        if let Some(input) = &mut self.adding {
            match key.code {
                KeyCode::Enter => {
                    let entry = input.trimmed().to_lowercase();
                    if !entry.is_empty() && !config.safety.trusted.contains(&entry) {
                        config.safety.trusted.push(entry);
                        self.changed = true;
                        self.trusted = Some(config.safety.trusted.len() - 1);
                    }
                    self.adding = None;
                }
                KeyCode::Esc => self.adding = None,
                _ => {
                    input.handle(key);
                }
            }
            return SettingsAction::None;
        }

        if let Some(i) = self.trusted {
            let len = config.safety.trusted.len();
            match key.code {
                KeyCode::Esc | KeyCode::Left => self.trusted = None,
                KeyCode::Up | KeyCode::Char('k') => self.trusted = Some(i.saturating_sub(1)),
                KeyCode::Down | KeyCode::Char('j') if len > 0 => {
                    self.trusted = Some((i + 1).min(len - 1))
                }
                KeyCode::Char('a') | KeyCode::Enter => self.adding = Some(Input::default()),
                KeyCode::Char('d') | KeyCode::Delete | KeyCode::Backspace if i < len => {
                    config.safety.trusted.remove(i);
                    self.changed = true;
                    self.trusted = Some(i.min(config.safety.trusted.len().saturating_sub(1)));
                }
                _ => {}
            }
            return SettingsAction::None;
        }

        let item = ITEMS[self.selected];
        match key.code {
            KeyCode::Esc | KeyCode::Char(',') | KeyCode::Char('q') => {
                let rescan = std::mem::take(&mut self.changed);
                return SettingsAction::Close {
                    changed: rescan || std::mem::take(&mut self.prefs_changed),
                    rescan,
                };
            }
            KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => {
                self.selected = (self.selected + 1).min(ITEMS.len() - 1)
            }
            KeyCode::Left | KeyCode::Right => {
                let forward = key.code == KeyCode::Right;
                match item {
                    Item::Recent => {
                        config.safety.recent_days =
                            step(&RECENT_DAYS, config.safety.recent_days, forward);
                        self.changed = true;
                    }
                    Item::ScanLimit => {
                        config.safety.scan_limit =
                            step(&SCAN_LIMITS, config.safety.scan_limit, forward);
                        self.changed = true;
                    }
                    Item::AutoLeave => {
                        config.prefs.unsubscribe_with_delete =
                            !config.prefs.unsubscribe_with_delete;
                        self.prefs_changed = true;
                    }
                    _ => {}
                }
            }
            KeyCode::Enter => match item {
                Item::Account => return SettingsAction::ChangeAccount,
                Item::Trusted => {
                    self.trusted = Some(0);
                    if config.safety.trusted.is_empty() {
                        self.adding = Some(Input::default());
                    }
                }
                Item::Password => return SettingsAction::ForgetPassword,
                Item::AutoLeave => {
                    config.prefs.unsubscribe_with_delete = !config.prefs.unsubscribe_with_delete;
                    self.prefs_changed = true;
                }
                Item::Icons => {
                    config.prefs.icons = next_icons(config.prefs.icons);
                    self.prefs_changed = true;
                }
                _ => {}
            },
            _ => {}
        }
        SettingsAction::None
    }

    pub fn draw(
        &self,
        f: &mut Frame,
        area: Rect,
        config: &Config,
        password_saved: bool,
        demo: bool,
    ) {
        let label = |s: &str, on: bool| {
            Span::styled(
                format!("{}{s:<22}", if on { "▶ " } else { "  " }),
                if on { theme::key() } else { theme::muted() },
            )
        };
        let value = |s: String| Span::styled(s, Style::new().fg(BONE));
        let hint = |s: &str| Span::styled(format!("  {s}"), theme::muted());
        let icons = theme::icons(config.prefs.icons);

        let mut lines = Vec::new();
        for (i, item) in ITEMS.iter().enumerate() {
            let on = i == self.selected && self.trusted.is_none();
            let line = match item {
                Item::Account => Line::from(vec![
                    label("Account", on),
                    value(if demo {
                        "demo inbox".into()
                    } else {
                        config.account.username.clone()
                    }),
                    hint(if demo { "" } else { "enter to change" }),
                ]),
                Item::Recent => Line::from(vec![
                    label("Keep mail newer than", on),
                    value(format!("◀ {} days ▶", config.safety.recent_days)),
                ]),
                Item::ScanLimit => Line::from(vec![
                    label("Scan", on),
                    value(if config.safety.scan_limit == 0 {
                        "◀ whole inbox ▶".into()
                    } else {
                        format!(
                            "◀ newest {} ▶",
                            super::ui::thousands(config.safety.scan_limit)
                        )
                    }),
                ]),
                Item::Trusted => Line::from(vec![
                    label("Never touch", on),
                    value(match config.safety.trusted.len() {
                        0 => "nobody extra yet".into(),
                        1 => "1 sender or domain".into(),
                        n => format!("{n} senders or domains"),
                    }),
                    hint("enter to edit"),
                ]),
                Item::AutoLeave => Line::from(vec![
                    label("Unsubscribe on kill", on),
                    value(if config.prefs.unsubscribe_with_delete {
                        "◀ yes ▶".into()
                    } else {
                        "◀ no ▶".into()
                    }),
                    hint(&format!("{} marks {} too", icons.kill, icons.leave)),
                ]),
                Item::Icons => Line::from(vec![
                    label("Icons", on),
                    value(match config.prefs.icons {
                        IconSet::Symbols => "◀ symbols ▶".into(),
                        IconSet::NerdFont => "◀ Nerd Font ▶".into(),
                    }),
                    hint(&match config.prefs.icons {
                        IconSet::Symbols => {
                            format!("{} kill  {} unsubscribe", icons.kill, icons.leave)
                        }
                        IconSet::NerdFont => {
                            format!("{} {}  needs a Nerd Font", icons.kill, icons.leave)
                        }
                    }),
                ]),
                Item::Password => Line::from(vec![
                    label("Password", on),
                    Span::styled(
                        if password_saved {
                            "saved in the system keychain"
                        } else {
                            "asked each time"
                        },
                        Style::new().fg(if password_saved { ALIVE } else { AMBER }),
                    ),
                    hint(if password_saved {
                        "enter to forget it"
                    } else {
                        ""
                    }),
                ]),
            };
            lines.push(line);

            if *item == Item::Trusted && self.trusted.is_some() {
                for (j, t) in config.safety.trusted.iter().enumerate() {
                    let sel = self.trusted == Some(j) && self.adding.is_none();
                    lines.push(Line::from(vec![
                        Span::raw("        "),
                        Span::styled(
                            format!("{} {t}", if sel { "▶" } else { " " }),
                            Style::new().fg(if sel { AMBER } else { ALIVE }),
                        ),
                    ]));
                }
                if let Some(input) = &self.adding {
                    let mut l = input.line("  Add", true, "name@example.com or @example.com");
                    l.spans.insert(0, Span::raw("      "));
                    lines.push(l);
                }
                lines.push(Line::from(Span::styled(
                    "        a add   d remove   esc done",
                    theme::key(),
                )));
            }
        }
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Always protected: people you write to, starred and replied-to mail, and legal, tax and security notices.",
            theme::muted(),
        )));
        if let Some(n) = &self.note {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(n.clone(), Style::new().fg(AMBER))));
        }
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "↑↓ choose   ←→ change   enter open   esc save and close",
            theme::key(),
        )));

        let text_width = area.width.min(80).saturating_sub(4);
        let height = (super::ui::wrapped_height(&lines, text_width) + 4).min(area.height);
        let [row] = Layout::vertical([Constraint::Length(height)])
            .flex(Flex::Center)
            .areas(area);
        let [rect] = Layout::horizontal([Constraint::Max(80)])
            .flex(Flex::Center)
            .areas(row);
        f.render_widget(Clear, rect);
        let block = Block::bordered()
            .border_type(BorderType::Double)
            .border_style(Style::new().fg(PHOSPHOR))
            .title(Span::styled(
                " SETTINGS ",
                theme::title().add_modifier(Modifier::BOLD),
            ))
            .style(Style::new().bg(VOID).fg(BONE));
        let inner = block.inner(rect);
        f.render_widget(block, rect);
        let [text_area] = Layout::horizontal([Constraint::Fill(1)])
            .horizontal_margin(1)
            .vertical_margin(1)
            .areas(inner);
        f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), text_area);
    }
}

fn next_icons(set: IconSet) -> IconSet {
    match set {
        IconSet::Symbols => IconSet::NerdFont,
        IconSet::NerdFont => IconSet::Symbols,
    }
}

/// Move to the next or previous preset, snapping odd values onto the list
fn step<T: Copy + PartialOrd>(options: &[T], current: T, forward: bool) -> T {
    let pos = options
        .iter()
        .position(|&o| o >= current)
        .unwrap_or(options.len() - 1);
    let exact = options[pos] == current;
    let next = match (forward, exact) {
        (true, true) => (pos + 1).min(options.len() - 1),
        (true, false) => pos,
        (false, _) => pos.saturating_sub(1),
    };
    options[next]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Security;

    fn config() -> Config {
        Config::new_account("imap.gmail.com", 993, "me@gmail.com", Security::Tls)
    }

    fn press(s: &mut Settings, c: &mut Config, code: KeyCode) -> SettingsAction {
        s.on_key(KeyEvent::from(code), c)
    }

    #[test]
    fn steps_through_presets() {
        assert_eq!(step(&RECENT_DAYS, 14, true), 30);
        assert_eq!(step(&RECENT_DAYS, 14, false), 7);
        assert_eq!(step(&RECENT_DAYS, 20, true), 30);
        assert_eq!(step(&RECENT_DAYS, 180, true), 180);
        assert_eq!(step(&RECENT_DAYS, 3, false), 3);
    }

    #[test]
    fn changes_are_reported_on_close() {
        let mut s = Settings::open();
        let mut c = config();
        press(&mut s, &mut c, KeyCode::Down);
        press(&mut s, &mut c, KeyCode::Right);
        assert_eq!(c.safety.recent_days, 30);
        assert!(matches!(
            press(&mut s, &mut c, KeyCode::Esc),
            SettingsAction::Close {
                changed: true,
                rescan: true
            }
        ));
    }

    #[test]
    fn trusted_senders_can_be_added_and_removed() {
        let mut s = Settings::open();
        let mut c = config();
        for _ in 0..3 {
            press(&mut s, &mut c, KeyCode::Down);
        }
        press(&mut s, &mut c, KeyCode::Enter);
        for ch in "@Family.org".chars() {
            press(&mut s, &mut c, KeyCode::Char(ch));
        }
        press(&mut s, &mut c, KeyCode::Enter);
        assert_eq!(c.safety.trusted, vec!["@family.org".to_string()]);
        press(&mut s, &mut c, KeyCode::Char('d'));
        assert!(c.safety.trusted.is_empty());
        press(&mut s, &mut c, KeyCode::Esc);
        assert!(matches!(
            press(&mut s, &mut c, KeyCode::Esc),
            SettingsAction::Close {
                changed: true,
                rescan: true
            }
        ));
    }

    #[test]
    fn preferences_save_without_a_rescan() {
        let mut s = Settings::open();
        let mut c = config();
        for _ in 0..4 {
            press(&mut s, &mut c, KeyCode::Down);
        }
        press(&mut s, &mut c, KeyCode::Right);
        assert!(!c.prefs.unsubscribe_with_delete);
        assert!(matches!(
            press(&mut s, &mut c, KeyCode::Esc),
            SettingsAction::Close {
                changed: true,
                rescan: false
            }
        ));
    }

    #[test]
    fn closing_without_changes_skips_the_rescan() {
        let mut s = Settings::open();
        let mut c = config();
        assert!(matches!(
            press(&mut s, &mut c, KeyCode::Esc),
            SettingsAction::Close { changed: false, .. }
        ));
    }
}
