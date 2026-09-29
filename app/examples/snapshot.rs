//! Render the demo board to HTML for screenshots: `cargo run --example snapshot -- 120 36 board > out.html`
//! Screens: board, confirm, scanning, help.

use chrono::Utc;
use crossterm::event::{KeyCode, KeyEvent};
use kill_email::config::Safety;
use kill_email::mail::{FakeStore, MailStore};
use kill_email::safety::SafetyRules;
use kill_email::senders::group_by_sender;
use kill_email::tui::app::{App, Progress};
use kill_email::tui::ui;
use kill_email::tui::worker::{Scan, Update};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::style::Color;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let width: u16 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(120);
    let height: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(36);
    let screen = args.get(3).map(String::as_str).unwrap_or("board");

    let mut app = App::new("you@example.com".into(), false, true, None);
    if screen == "scanning" {
        app.progress = Progress {
            stage: "Scanning",
            done: 18_250,
            total: 41_286,
        };
    } else {
        let mut store = FakeStore::demo();
        let folders = store.folders().unwrap();
        let msgs = store.scan("INBOX", 0, &mut |_, _| {}).unwrap();
        let rules = SafetyRules::new(&Safety::default(), store.sent_to.clone(), Utc::now());
        app.on_update(Update::Scanned(Scan {
            folders,
            groups: group_by_sender(&msgs, &rules),
            messages: msgs.len(),
            correspondents: 2,
        }));
        app.on_key(KeyEvent::from(KeyCode::Char(' ')));
        app.on_key(KeyEvent::from(KeyCode::Char(' ')));
        match screen {
            "confirm" => {
                app.on_key(KeyEvent::from(KeyCode::Enter));
            }
            "help" => {
                app.on_key(KeyEvent::from(KeyCode::Char('?')));
            }
            _ => {}
        }
    }

    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal.draw(|f| ui::draw(f, &mut app)).unwrap();
    let buf = terminal.backend().buffer();

    let css = |c: Color, fallback: &str| match c {
        Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
        _ => fallback.to_string(),
    };
    let mut html = String::from(
        "<!doctype html><meta charset=utf-8><style>body{margin:0;background:#0b0304}\
         pre{margin:0;padding:14px;font:15px/1.2 'JetBrains Mono',monospace;background:#0b0304}\
         span{white-space:pre}</style><pre>",
    );
    for y in 0..height {
        for x in 0..width {
            let cell = &buf[(x, y)];
            let bold = cell.modifier.contains(ratatui::style::Modifier::BOLD);
            let sym = cell
                .symbol()
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            html.push_str(&format!(
                "<span style=\"color:{};background:{}{}\">{}</span>",
                css(cell.fg, "#f2ddd8"),
                css(cell.bg, "#0b0304"),
                if bold { ";font-weight:700" } else { "" },
                sym
            ));
        }
        html.push('\n');
    }
    html.push_str("</pre>");
    print!("{html}");
}
