//! A one-line text field.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::style::Style;
use ratatui::text::{Line, Span};

use super::theme::{self, AMBER, BONE, PHOSPHOR};

#[derive(Debug, Clone, Default)]
pub struct Input {
    pub value: String,
    /// Cursor position in characters
    cursor: usize,
    masked: bool,
}

impl Input {
    pub fn new(value: &str) -> Self {
        Self {
            value: value.to_string(),
            cursor: value.chars().count(),
            masked: false,
        }
    }

    pub fn masked() -> Self {
        Self {
            masked: true,
            ..Self::default()
        }
    }

    pub fn set(&mut self, value: &str) {
        self.value = value.to_string();
        self.cursor = value.chars().count();
    }

    pub fn trimmed(&self) -> &str {
        self.value.trim()
    }

    /// Returns true when the key edited the field
    pub fn handle(&mut self, key: KeyEvent) -> bool {
        let len = self.value.chars().count();
        match key.code {
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.set("");
            }
            KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                let at = self.byte_index(self.cursor);
                self.value.insert(at, c);
                self.cursor += 1;
            }
            KeyCode::Backspace if self.cursor > 0 => {
                let at = self.byte_index(self.cursor - 1);
                self.value.remove(at);
                self.cursor -= 1;
            }
            KeyCode::Delete if self.cursor < len => {
                let at = self.byte_index(self.cursor);
                self.value.remove(at);
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(len),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = len,
            _ => return false,
        }
        true
    }

    pub fn paste(&mut self, text: &str) {
        // A pasted password often carries a trailing newline or spaces between groups
        let clean: String = text.chars().filter(|c| !c.is_control()).collect();
        let at = self.byte_index(self.cursor);
        self.value.insert_str(at, &clean);
        self.cursor += clean.chars().count();
    }

    fn byte_index(&self, chars: usize) -> usize {
        self.value
            .char_indices()
            .nth(chars)
            .map_or(self.value.len(), |(i, _)| i)
    }

    /// The field as a line, with a block cursor when focused
    pub fn line(&self, label: &str, focused: bool, placeholder: &str) -> Line<'static> {
        let shown: String = if self.masked {
            "•".repeat(self.value.chars().count())
        } else {
            self.value.clone()
        };
        let label_style = if focused {
            theme::key()
        } else {
            theme::muted()
        };
        let mut spans = vec![Span::styled(format!("{label:<10}"), label_style)];
        if shown.is_empty() && !focused {
            spans.push(Span::styled(placeholder.to_string(), theme::muted()));
            return Line::from(spans);
        }
        let chars: Vec<char> = shown.chars().collect();
        let before: String = chars[..self.cursor.min(chars.len())].iter().collect();
        let after: String = chars[self.cursor.min(chars.len())..].iter().collect();
        spans.push(Span::styled(before, Style::new().fg(BONE)));
        if focused {
            let (under, rest) = match after.chars().next() {
                Some(c) => (c.to_string(), after.chars().skip(1).collect()),
                None => (" ".to_string(), String::new()),
            };
            spans.push(Span::styled(under, Style::new().fg(theme::VOID).bg(AMBER)));
            spans.push(Span::styled(rest, Style::new().fg(BONE)));
            if shown.is_empty() {
                spans.push(Span::styled(format!(" {placeholder}"), theme::muted()));
            }
        } else {
            spans.push(Span::styled(after, Style::new().fg(PHOSPHOR)));
        }
        Line::from(spans)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: KeyCode) -> KeyEvent {
        KeyEvent::from(c)
    }

    #[test]
    fn edits_at_the_cursor() {
        let mut i = Input::new("gmal.com");
        for _ in 0..5 {
            i.handle(key(KeyCode::Left));
        }
        i.handle(key(KeyCode::Char('i')));
        assert_eq!(i.value, "gmail.com");
        i.handle(key(KeyCode::End));
        i.handle(key(KeyCode::Backspace));
        assert_eq!(i.value, "gmail.co");
    }

    #[test]
    fn paste_drops_newlines() {
        let mut i = Input::masked();
        i.paste("abcd efgh ijkl mnop\n");
        assert_eq!(i.value, "abcd efgh ijkl mnop");
        let line = i.line("Password", false, "");
        let text: String = line.spans.iter().map(|s| s.content.to_string()).collect();
        assert!(
            !text.contains("abcd"),
            "masked fields never show the password"
        );
    }

    #[test]
    fn handles_multibyte_text() {
        let mut i = Input::new("zoë");
        i.handle(key(KeyCode::Backspace));
        assert_eq!(i.value, "zo");
    }
}
