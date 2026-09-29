//! First-run setup: pick a provider, enter the address and password, connect.

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::{Constraint, Flex, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Clear, Paragraph, Wrap};

use super::input::Input;
use super::march::{self, March};
use super::theme::{self, ALIVE, AMBER, ASH, BONE, PHOSPHOR, VOID};
use crate::config::Config;
use crate::providers::{self, OTHER, PROVIDERS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Provider,
    Form,
    Connecting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Email,
    Host,
    Port,
    Password,
    Remember,
}

pub enum SetupAction {
    None,
    Connect {
        config: Box<Config>,
        password: String,
        remember: bool,
    },
    /// Leave setup without changing anything
    Cancel,
}

pub struct Setup {
    pub step: Step,
    pub provider: usize,
    pub email: Input,
    pub host: Input,
    pub port: Input,
    pub password: Input,
    pub remember: bool,
    focus: usize,
    pub error: Option<String>,
    /// The settings being replaced, so safety choices survive an account change
    base: Option<Config>,
}

impl Setup {
    pub fn new(base: Option<Config>) -> Self {
        let mut s = Self {
            step: Step::Provider,
            provider: 0,
            email: Input::default(),
            host: Input::default(),
            port: Input::new("993"),
            password: Input::masked(),
            remember: true,
            focus: 0,
            error: None,
            base: None,
        };
        if let Some(c) = &base {
            s.provider = providers::index_for_host(&c.account.host);
            s.email.set(&c.account.username);
            s.host.set(&c.account.host);
            s.port.set(&c.account.port.to_string());
        }
        s.base = base;
        s
    }

    /// Skip straight to the password, for a saved account whose password is missing
    pub fn ask_password(base: Config, error: Option<String>) -> Self {
        let mut s = Self::new(Some(base));
        s.step = Step::Form;
        s.focus = s
            .fields()
            .iter()
            .position(|f| *f == Field::Password)
            .unwrap_or(0);
        s.error = error;
        s
    }

    pub fn can_cancel(&self) -> bool {
        self.base.is_some()
    }

    fn fields(&self) -> Vec<Field> {
        if self.provider == OTHER {
            vec![
                Field::Email,
                Field::Host,
                Field::Port,
                Field::Password,
                Field::Remember,
            ]
        } else {
            vec![Field::Email, Field::Password, Field::Remember]
        }
    }

    fn focused(&self) -> Field {
        self.fields()[self.focus.min(self.fields().len() - 1)]
    }

    pub fn failed(&mut self, error: String) {
        self.step = Step::Form;
        self.error = Some(error);
        self.focus = self
            .fields()
            .iter()
            .position(|f| *f == Field::Password)
            .unwrap_or(0);
    }

    pub fn paste(&mut self, text: &str) {
        if self.step != Step::Form {
            return;
        }
        match self.focused() {
            Field::Email => self.email.paste(text.trim()),
            Field::Host => self.host.paste(text.trim()),
            Field::Port => self.port.paste(text.trim()),
            Field::Password => self.password.paste(text),
            Field::Remember => {}
        }
    }

    pub fn on_key(&mut self, key: KeyEvent) -> SetupAction {
        match self.step {
            Step::Provider => self.provider_key(key),
            Step::Form => self.form_key(key),
            Step::Connecting => SetupAction::None,
        }
    }

    fn provider_key(&mut self, key: KeyEvent) -> SetupAction {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => self.provider = self.provider.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => {
                self.provider = (self.provider + 1).min(PROVIDERS.len() - 1)
            }
            KeyCode::Enter => {
                if let Some(why) = PROVIDERS[self.provider].unavailable {
                    self.error = Some(why.to_string());
                } else {
                    self.error = None;
                    self.step = Step::Form;
                    self.focus = 0;
                    if self.provider != OTHER {
                        self.host.set(PROVIDERS[self.provider].host);
                        self.port.set(&PROVIDERS[self.provider].port.to_string());
                    }
                }
            }
            KeyCode::Esc if self.can_cancel() => return SetupAction::Cancel,
            _ => {}
        }
        SetupAction::None
    }

    fn form_key(&mut self, key: KeyEvent) -> SetupAction {
        let count = self.fields().len();
        match key.code {
            KeyCode::Esc => {
                self.step = Step::Provider;
                self.error = None;
            }
            KeyCode::Tab | KeyCode::Down => self.focus = (self.focus + 1) % count,
            KeyCode::BackTab | KeyCode::Up => self.focus = (self.focus + count - 1) % count,
            KeyCode::Char(' ') if self.focused() == Field::Remember => {
                self.remember = !self.remember
            }
            KeyCode::Enter => {
                // Enter moves through the form and connects from the last field
                if self.focused() == Field::Remember || self.focused() == Field::Password {
                    return self.submit();
                }
                self.focus = (self.focus + 1) % count;
            }
            _ => {
                let field = match self.focused() {
                    Field::Email => &mut self.email,
                    Field::Host => &mut self.host,
                    Field::Port => &mut self.port,
                    Field::Password => &mut self.password,
                    Field::Remember => return SetupAction::None,
                };
                if field.handle(key) {
                    self.error = None;
                }
            }
        }
        SetupAction::None
    }

    fn submit(&mut self) -> SetupAction {
        let email = self.email.trimmed().to_string();
        let host = self.host.trimmed().to_lowercase();
        let port = self.port.trimmed().parse::<u16>();
        let error = if email.is_empty() {
            Some("Enter your email address")
        } else if self.provider != OTHER && !email.contains('@') {
            Some("That doesn't look like an email address")
        } else if host.is_empty() {
            Some("Enter your mail server, like imap.example.com")
        } else if port.is_err() {
            Some("The port should be a number, usually 993")
        } else if self.password.value.is_empty() {
            Some("Enter your password")
        } else {
            None
        };
        if let Some(e) = error {
            self.error = Some(e.to_string());
            return SetupAction::None;
        }
        let port = port.unwrap_or(993);
        let mut config =
            Config::new_account(&host, port, &email, providers::security_for(&host, port));
        if let Some(base) = &self.base {
            config.safety = base.safety.clone();
            if base.account.host == host {
                config.account.trash = base.account.trash.clone();
                config.account.sent = base.account.sent.clone();
            }
        }
        if let Err(e) = config.validate() {
            self.error = Some(e.to_string());
            return SetupAction::None;
        }
        self.error = None;
        self.step = Step::Connecting;
        SetupAction::Connect {
            config: Box::new(config),
            password: self.password.value.clone(),
            remember: self.remember,
        }
    }

    pub fn draw(&self, f: &mut Frame, area: Rect, tick: u64) {
        let lines = match self.step {
            Step::Provider => self.provider_lines(),
            Step::Form => self.form_lines(),
            Step::Connecting => vec![
                Line::from(Span::styled(
                    format!("Connecting to {}...", self.host.trimmed()),
                    Style::new().fg(BONE).add_modifier(Modifier::BOLD),
                )),
                Line::from(""),
            ],
        };
        let extra = if self.step == Step::Connecting {
            march::HEIGHT
        } else {
            0
        };
        // Panel width 76, minus borders and margins
        let text_width = area.width.min(76).saturating_sub(4);
        let height = (super::ui::wrapped_height(&lines, text_width) + 4 + extra).min(area.height);
        let [row] = Layout::vertical([Constraint::Length(height)])
            .flex(Flex::Center)
            .areas(area);
        let [rect] = Layout::horizontal([Constraint::Max(76)])
            .flex(Flex::Center)
            .areas(row);
        f.render_widget(Clear, rect);
        let block = Block::bordered()
            .border_type(BorderType::Double)
            .border_style(Style::new().fg(PHOSPHOR))
            .title(Span::styled(" SET UP YOUR MAILBOX ", theme::title()))
            .style(Style::new().bg(VOID).fg(BONE));
        let inner = block.inner(rect);
        f.render_widget(block, rect);
        let [text_area] = Layout::horizontal([Constraint::Fill(1)])
            .horizontal_margin(1)
            .vertical_margin(1)
            .areas(inner);
        f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), text_area);
        if self.step == Step::Connecting {
            let strip = Rect {
                y: text_area.y + 2,
                height: march::HEIGHT.min(text_area.height.saturating_sub(2)),
                ..text_area
            };
            f.render_widget(March { tick }, strip);
        }
    }

    fn provider_lines(&self) -> Vec<Line<'static>> {
        let mut lines = vec![
            Line::from("Where is your mail?")
                .style(Style::new().fg(BONE).add_modifier(Modifier::BOLD)),
            Line::from(""),
        ];
        for (i, p) in PROVIDERS.iter().enumerate() {
            let selected = i == self.provider;
            let marker = if selected { "▶ " } else { "  " };
            let style = match (selected, p.unavailable.is_some()) {
                (true, false) => Style::new()
                    .fg(VOID)
                    .bg(PHOSPHOR)
                    .add_modifier(Modifier::BOLD),
                (true, true) => Style::new().fg(ASH).bg(theme::GLASS),
                (false, true) => Style::new().fg(ASH),
                (false, false) => Style::new().fg(BONE),
            };
            let note = if p.unavailable.is_some() {
                "  (coming soon)"
            } else {
                ""
            };
            lines.push(Line::from(vec![
                Span::styled(marker, Style::new().fg(PHOSPHOR)),
                Span::styled(format!(" {:<20}", p.name), style),
                Span::styled(note, theme::muted()),
            ]));
        }
        lines.push(Line::from(""));
        if let Some(e) = &self.error {
            lines.push(Line::from(Span::styled(e.clone(), Style::new().fg(AMBER))));
            lines.push(Line::from(""));
        }
        let back = if self.can_cancel() {
            "   esc back"
        } else {
            "   ctrl-c quit"
        };
        lines.push(Line::from(Span::styled(
            format!("↑↓ choose   enter next{back}"),
            theme::key(),
        )));
        lines
    }

    fn form_lines(&self) -> Vec<Line<'static>> {
        let p = &PROVIDERS[self.provider];
        let mut lines = vec![
            Line::from(Span::styled(
                p.name,
                Style::new().fg(BONE).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
        ];
        let focus = self.focused();
        for field in self.fields() {
            let on = field == focus;
            lines.push(match field {
                Field::Email => self.email.line("Email", on, "you@example.com"),
                Field::Host => self.host.line("Server", on, "imap.example.com"),
                Field::Port => self.port.line("Port", on, "993"),
                Field::Password => self.password.line("Password", on, ""),
                Field::Remember => {
                    let label_style = if on { theme::key() } else { theme::muted() };
                    Line::from(vec![
                        Span::styled(format!("{:<10}", ""), label_style),
                        Span::styled(
                            if self.remember { "[x] " } else { "[ ] " },
                            Style::new().fg(if on { AMBER } else { ALIVE }),
                        ),
                        Span::styled(
                            "Remember the password in the system keychain",
                            Style::new().fg(BONE),
                        ),
                    ])
                }
            });
        }
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            p.password_help.to_string(),
            theme::muted(),
        )));
        lines.push(Line::from(Span::styled(
            "Only message headers are read. Nothing leaves your computer except to your mail server.",
            theme::muted(),
        )));
        lines.push(Line::from(""));
        if let Some(e) = &self.error {
            lines.push(Line::from(Span::styled(e.clone(), Style::new().fg(AMBER))));
            lines.push(Line::from(""));
        }
        lines.push(Line::from(Span::styled(
            "tab next field   enter connect   esc back",
            theme::key(),
        )));
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Security;

    fn typed(s: &mut Setup, text: &str) {
        for c in text.chars() {
            s.on_key(KeyEvent::from(KeyCode::Char(c)));
        }
    }

    #[test]
    fn gmail_setup_builds_the_right_account() {
        let mut s = Setup::new(None);
        s.on_key(KeyEvent::from(KeyCode::Enter));
        assert_eq!(s.step, Step::Form);
        typed(&mut s, "me@gmail.com");
        s.on_key(KeyEvent::from(KeyCode::Tab));
        s.paste("abcd efgh ijkl mnop\n");
        match s.on_key(KeyEvent::from(KeyCode::Enter)) {
            SetupAction::Connect {
                config,
                password,
                remember,
            } => {
                assert_eq!(config.account.host, "imap.gmail.com");
                assert_eq!(config.account.port, 993);
                assert_eq!(config.account.security, Security::Tls);
                assert_eq!(config.account.username, "me@gmail.com");
                assert_eq!(password, "abcd efgh ijkl mnop");
                assert!(remember);
            }
            _ => panic!("expected a connect"),
        }
        assert_eq!(s.step, Step::Connecting);
    }

    #[test]
    fn missing_fields_are_explained() {
        let mut s = Setup::new(None);
        s.on_key(KeyEvent::from(KeyCode::Enter));
        s.on_key(KeyEvent::from(KeyCode::Tab));
        assert!(matches!(
            s.on_key(KeyEvent::from(KeyCode::Enter)),
            SetupAction::None
        ));
        assert_eq!(s.error.as_deref(), Some("Enter your email address"));
    }

    #[test]
    fn outlook_is_not_offered_yet() {
        let mut s = Setup::new(None);
        s.provider = PROVIDERS
            .iter()
            .position(|p| p.unavailable.is_some())
            .unwrap();
        s.on_key(KeyEvent::from(KeyCode::Enter));
        assert_eq!(s.step, Step::Provider);
        assert!(s.error.is_some());
    }

    #[test]
    fn other_provider_asks_for_the_server() {
        let mut s = Setup::new(None);
        s.provider = OTHER;
        s.on_key(KeyEvent::from(KeyCode::Enter));
        typed(&mut s, "tester");
        s.on_key(KeyEvent::from(KeyCode::Tab));
        typed(&mut s, "127.0.0.1");
        s.on_key(KeyEvent::from(KeyCode::Tab));
        s.on_key(KeyEvent::from(KeyCode::Char('u')).with_ctrl());
        typed(&mut s, "1143");
        s.on_key(KeyEvent::from(KeyCode::Tab));
        typed(&mut s, "testpass");
        match s.on_key(KeyEvent::from(KeyCode::Enter)) {
            SetupAction::Connect { config, .. } => {
                assert_eq!(config.account.port, 1143);
                assert_eq!(config.account.security, Security::None);
            }
            _ => panic!("expected a connect"),
        }
    }

    trait Ctrl {
        fn with_ctrl(self) -> Self;
    }
    impl Ctrl for KeyEvent {
        fn with_ctrl(mut self) -> Self {
            self.modifiers = crossterm::event::KeyModifiers::CONTROL;
            self
        }
    }
}
