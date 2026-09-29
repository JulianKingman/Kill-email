//! Drawing. Everything here reads `App` and writes to the frame.

use chrono::Utc;
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Flex, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Cell, Clear, Gauge, Paragraph, Row, Table, Wrap};

use super::app::{App, Mode, Tone};
use super::march::{self, March};
use super::theme::{self, ALIVE, AMBER, ASH, BONE, EMBER, LOGO, MARK, PHOSPHOR, VOID};
use crate::senders::SenderGroup;

pub fn draw(f: &mut Frame, app: &mut App) {
    let area = f.area();
    f.render_widget(Block::new().style(theme::base()), area);

    let [header, body, footer] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(8),
        Constraint::Length(3),
    ])
    .areas(area);
    draw_header(f, header, app);

    match app.mode {
        Mode::Scanning => draw_scanning(f, body, app),
        Mode::Setup => draw_backdrop(f, body),
        _ => draw_board(f, body, app),
    }
    draw_footer(f, footer, app);

    match &app.mode {
        Mode::Confirm => draw_confirm(f, area, app),
        Mode::ConfirmUndo(batch) => {
            let text = vec![
                Line::from(format!(
                    "Put back {} messages from batch {}?",
                    batch.messages, batch.id
                )),
                Line::from(""),
                Line::from("They move from Trash back to where they came from.")
                    .style(theme::muted()),
            ];
            modal(f, area, " UNDO ", text, "y restore   n cancel");
        }
        Mode::Working => draw_working(f, area, app),
        Mode::Help => draw_help(f, area),
        Mode::Setup => app.setup.draw(f, body, app.tick),
        Mode::Settings => app
            .settings
            .draw(f, body, &app.config, app.password_saved, app.demo),
        _ => {}
    }
}

fn draw_header(f: &mut Frame, area: Rect, app: &App) {
    let mut spans = vec![
        Span::styled(format!(" {MARK} "), theme::title()),
        Span::styled("KILL ALL EMAIL", theme::title()),
        Span::styled(
            if matches!(app.mode, Mode::Setup) {
                "  ·  SETUP"
            } else {
                "  ·  MODE: KILL LIST"
            },
            Style::new().fg(AMBER),
        ),
    ];
    if !app.account().is_empty() {
        spans.push(Span::styled(
            format!("  ·  {}", app.account()),
            theme::muted(),
        ));
    }
    if app.messages > 0 {
        spans.push(Span::styled(
            format!("  ·  {} {}", app.folder, thousands(app.messages)),
            theme::muted(),
        ));
    }
    if app.demo {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            " DEMO ",
            Style::new().fg(VOID).bg(AMBER).bold(),
        ));
    }
    if app.dry_run {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            " DRY RUN ",
            Style::new().fg(VOID).bg(AMBER).bold(),
        ));
    }
    let block = Block::new()
        .borders(ratatui::widgets::Borders::BOTTOM)
        .border_style(theme::border());
    f.render_widget(Paragraph::new(Line::from(spans)).block(block), area);
}

/// The logo on its own, behind the setup panel
fn draw_backdrop(f: &mut Frame, area: Rect) {
    if area.width as usize >= LOGO[0].chars().count() + 4 && area.height >= 30 {
        let logo: Vec<Line> = LOGO
            .iter()
            .map(|l| Line::from(*l).style(Style::new().fg(EMBER)))
            .collect();
        let [top] = Layout::vertical([Constraint::Length(LOGO.len() as u16 + 1)]).areas(area);
        f.render_widget(Paragraph::new(logo).alignment(Alignment::Center), top);
    }
}

fn draw_scanning(f: &mut Frame, area: Rect, app: &App) {
    let logo_fits = area.width as usize >= LOGO[0].chars().count() + 4 && area.height >= 14;
    let logo_height = if logo_fits { LOGO.len() as u16 + 2 } else { 2 };
    let [_, logo_area, march_area, gauge_area, note_area, _] = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(logo_height),
        Constraint::Length(march::HEIGHT + 1),
        Constraint::Length(3),
        Constraint::Length(2),
        Constraint::Fill(1),
    ])
    .areas(area);

    let logo: Vec<Line> = if logo_fits {
        LOGO.iter()
            .map(|l| Line::from(*l).style(Style::new().fg(PHOSPHOR)))
            .collect()
    } else {
        vec![Line::from(format!("{MARK} KILL ALL EMAIL")).style(theme::title())]
    };
    f.render_widget(Paragraph::new(logo).alignment(Alignment::Center), logo_area);

    let [march_area] = Layout::horizontal([Constraint::Max(70)])
        .flex(Flex::Center)
        .areas(march_area);
    f.render_widget(March { tick: app.tick }, march_area);

    let p = &app.progress;
    let [gauge_area] = Layout::horizontal([Constraint::Max(70)])
        .flex(Flex::Center)
        .areas(gauge_area);
    let label = if p.total > 0 {
        format!(
            "{} {} / {}",
            p.stage.to_uppercase(),
            thousands(p.done),
            thousands(p.total)
        )
    } else {
        format!("{}...", p.stage.to_uppercase())
    };
    let ratio = if p.total > 0 {
        p.done as f64 / p.total as f64
    } else {
        0.0
    };
    let gauge = Gauge::default()
        .block(
            Block::bordered()
                .border_type(BorderType::Plain)
                .border_style(theme::border()),
        )
        .gauge_style(Style::new().fg(PHOSPHOR).bg(theme::GLASS))
        .label(Span::styled(label, Style::new().fg(BONE).bold()))
        .ratio(ratio.clamp(0.0, 1.0));
    f.render_widget(gauge, gauge_area);

    let note = if let Some((text, Tone::Warn)) = &app.status {
        Line::from(text.as_str()).style(Style::new().fg(AMBER))
    } else {
        Line::from("Reading headers only. Message bodies never leave your mail server.")
            .style(theme::muted())
    };
    f.render_widget(
        Paragraph::new(note)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: true }),
        note_area,
    );
}

fn draw_board(f: &mut Frame, area: Rect, app: &mut App) {
    let wide = area.width >= 110;
    let (list_area, detail_area) = if wide {
        let [l, d] = Layout::horizontal([Constraint::Min(60), Constraint::Length(42)]).areas(area);
        (l, d)
    } else {
        let [l, d] = Layout::vertical([Constraint::Min(6), Constraint::Length(9)]).areas(area);
        (l, d)
    };
    draw_table(f, list_area, app);
    draw_detail(f, detail_area, app);
}

fn draw_table(f: &mut Frame, area: Rect, app: &mut App) {
    let header = Row::new(["", "SENDER", "EMAILS", "READ", "LAST", "UNSUB", "VERDICT"])
        .style(Style::new().fg(ASH).add_modifier(Modifier::BOLD))
        .bottom_margin(0);

    let rows: Vec<Row> = app
        .groups
        .iter()
        .enumerate()
        .map(|(i, g)| {
            let marked = app.marked.contains(&g.address);
            let (verdict, color) = verdict(g);
            let fg = if marked {
                AMBER
            } else if g.protected.is_some() {
                ALIVE
            } else {
                BONE
            };
            Row::new(vec![
                Cell::from(if marked { "[x]" } else { "[ ]" }),
                Cell::from(g.display_name().to_string()),
                Cell::from(Line::from(thousands(g.total)).alignment(Alignment::Right)),
                Cell::from(Line::from(format!("{}%", g.read_pct())).alignment(Alignment::Right)),
                Cell::from(g.newest.map(ago).unwrap_or_else(|| "—".into())),
                Cell::from(g.unsubscribe.label()),
                Cell::from(Span::styled(
                    verdict,
                    Style::new().fg(if marked { AMBER } else { color }),
                )),
            ])
            .style(Style::new().fg(fg).bg(theme::row_bg(i)))
        })
        .collect();

    let widths = [
        Constraint::Length(3),
        Constraint::Fill(3),
        Constraint::Length(7),
        Constraint::Length(5),
        Constraint::Length(6),
        Constraint::Length(8),
        Constraint::Length(17),
    ];
    let title = Line::from(vec![
        Span::styled(" SENDERS ", theme::title()),
        Span::styled(format!("by {} ", app.sort.label()), theme::muted()),
    ]);
    let table = Table::new(rows, widths)
        .header(header)
        .column_spacing(1)
        .block(Block::bordered().border_style(theme::border()).title(title))
        .row_highlight_style(Style::new().bg(EMBER).fg(BONE).add_modifier(Modifier::BOLD))
        .highlight_symbol("▶");
    f.render_stateful_widget(table, area, &mut app.table);
}

fn verdict(g: &SenderGroup) -> (String, ratatui::style::Color) {
    if g.protected.is_some() {
        return ("PROTECTED".into(), ALIVE);
    }
    if g.targets.is_empty() {
        return ("ALL KEPT".into(), ALIVE);
    }
    let held = g.held_total();
    if held > 0 {
        (
            format!(
                "✖ {} · {} kept",
                thousands(g.targets.len()),
                thousands(held)
            ),
            PHOSPHOR,
        )
    } else {
        (format!("✖ {}", thousands(g.targets.len())), PHOSPHOR)
    }
}

fn draw_detail(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::bordered()
        .border_style(theme::border())
        .title(Span::styled(" TARGET ", theme::title()));
    let Some(g) = app.selected() else {
        f.render_widget(Paragraph::new("No mail found.").block(block), area);
        return;
    };

    let label = |s: &str| Span::styled(format!("{s:<13}"), theme::muted());
    let mut lines = vec![
        Line::from(Span::styled(
            g.display_name().to_string(),
            Style::new().fg(BONE).bold(),
        )),
        Line::from(Span::styled(g.address.clone(), theme::muted())),
        Line::from(""),
        Line::from(vec![
            label("Emails"),
            Span::raw(format!(
                "{} ({} unread)",
                thousands(g.total),
                thousands(g.unread)
            )),
        ]),
        Line::from(vec![label("Size"), Span::raw(megabytes(g.bytes))]),
        Line::from(vec![
            label("Span"),
            Span::raw(match (g.oldest, g.newest) {
                (Some(o), Some(n)) => format!("{} to {}", o.format("%b %Y"), n.format("%b %Y")),
                _ => "unknown".into(),
            }),
        ]),
        Line::from(vec![label("Unsubscribe"), Span::raw(g.unsubscribe.label())]),
        Line::from(vec![
            label("Mailing list"),
            Span::raw(if g.bulk { "yes" } else { "no" }),
        ]),
        Line::from(""),
    ];
    if let Some(hold) = g.protected {
        lines.push(Line::from(Span::styled(
            format!("Protected: {}", hold.label()),
            Style::new().fg(ALIVE),
        )));
        lines.push(Line::from(Span::styled(
            "Kill Email will not touch this sender.",
            theme::muted(),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            format!("{} would go to Trash", thousands(g.targets.len())),
            Style::new().fg(PHOSPHOR).bold(),
        )));
        for (hold, n) in &g.held {
            lines.push(Line::from(Span::styled(
                format!("  kept {n}: {}", hold.label()),
                Style::new().fg(ALIVE),
            )));
        }
    }
    f.render_widget(
        Paragraph::new(lines)
            .block(block)
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn draw_footer(f: &mut Frame, area: Rect, app: &App) {
    let [status, keys] =
        Layout::vertical([Constraint::Length(1), Constraint::Length(2)]).areas(area);

    let (senders, messages, bytes) = app.chosen_totals();
    let status_line = match &app.status {
        Some((text, tone)) => {
            let color = match tone {
                Tone::Good => ALIVE,
                Tone::Warn => AMBER,
                Tone::Info => BONE,
            };
            Line::from(Span::styled(format!(" {text}"), Style::new().fg(color)))
        }
        None if !app.marked.is_empty() => Line::from(Span::styled(
            format!(
                " Marked {senders} senders: {} messages, {}",
                thousands(messages),
                megabytes(bytes)
            ),
            Style::new().fg(AMBER),
        )),
        None if app.messages > 0 => Line::from(Span::styled(
            format!(
                " {} senders · learned {} people you write to from Sent",
                thousands(app.groups.len()),
                thousands(app.correspondents)
            ),
            theme::muted(),
        )),
        None => Line::from(""),
    };
    f.render_widget(Paragraph::new(status_line), status);

    let hints: &[(&str, &str)] = match app.mode {
        Mode::Board => &[
            ("↑↓", "move"),
            ("space", "mark"),
            ("enter", "terminate"),
            ("u", "undo"),
            ("s", "sort"),
            ("r", "rescan"),
            (",", "settings"),
            ("?", "help"),
            ("q", "quit"),
        ],
        // Setup and settings show their own keys, and q is just a letter there
        Mode::Setup | Mode::Settings => &[],
        _ => &[("q", "quit")],
    };
    let mut spans = vec![Span::raw(" ")];
    for (k, what) in hints {
        spans.push(Span::styled(*k, theme::key()));
        spans.push(Span::styled(format!(" {what}   "), theme::muted()));
    }
    let block = Block::new()
        .borders(ratatui::widgets::Borders::TOP)
        .border_style(theme::border());
    f.render_widget(Paragraph::new(Line::from(spans)).block(block), keys);
}

fn draw_confirm(f: &mut Frame, area: Rect, app: &App) {
    let (senders, messages, bytes) = app.chosen_totals();
    let names: Vec<String> = app
        .chosen()
        .iter()
        .take(4)
        .map(|g| g.display_name().to_string())
        .collect();
    let more = senders.saturating_sub(names.len());
    let mut text = vec![
        Line::from(Span::styled(
            format!(
                "Terminate {} messages from {} sender{}?",
                thousands(messages),
                senders,
                if senders == 1 { "" } else { "s" }
            ),
            Style::new().fg(BONE).bold(),
        )),
        Line::from(""),
    ];
    for n in names {
        text.push(Line::from(format!("  ✖ {n}")).style(Style::new().fg(PHOSPHOR)));
    }
    if more > 0 {
        text.push(Line::from(format!("  and {more} more")).style(theme::muted()));
    }
    text.push(Line::from(""));
    if app.dry_run {
        text.push(Line::from("Dry run: nothing will be moved.").style(Style::new().fg(AMBER)));
    } else {
        text.push(
            Line::from(format!(
                "Frees about {}. Everything goes to Trash;",
                megabytes(bytes)
            ))
            .style(theme::muted()),
        );
        text.push(
            Line::from("press u, or run `kill-email undo`, to put it back.").style(theme::muted()),
        );
    }
    modal(
        f,
        area,
        " CONFIRM TERMINATION ",
        text,
        "y execute   n cancel",
    );
}

fn draw_working(f: &mut Frame, area: Rect, app: &App) {
    let p = &app.progress;
    let mut text = vec![
        Line::from(if p.total > 0 {
            format!("{} {} / {}", p.stage, thousands(p.done), thousands(p.total))
        } else {
            format!("{}...", p.stage)
        })
        .style(Style::new().fg(BONE).bold()),
        Line::from(""),
    ];
    // Room for the squad below the status line
    text.extend((0..march::HEIGHT).map(|_| Line::from("")));
    let rect = modal(f, area, " WORKING ", text, "");
    let inner = Rect {
        x: rect.x + 1,
        y: rect.y + 3,
        width: rect.width.saturating_sub(2),
        height: march::HEIGHT.min(rect.height.saturating_sub(4)),
    };
    f.render_widget(March { tick: app.tick }, inner);
}

fn draw_help(f: &mut Frame, area: Rect) {
    let rows = [
        ("space", "mark or unmark the sender"),
        (
            "enter / d",
            "terminate marked senders (or the highlighted one)",
        ),
        ("u", "undo the last termination"),
        ("s", "sort: most mail, least read, oldest"),
        ("r", "rescan the inbox"),
        (",", "settings: account, what to protect, how much to scan"),
        ("q", "quit"),
    ];
    let mut text: Vec<Line> = rows
        .iter()
        .map(|(k, v)| {
            Line::from(vec![
                Span::styled(format!("{k:<11}"), theme::key()),
                Span::raw(*v),
            ])
        })
        .collect();
    text.push(Line::from(""));
    text.push(
        Line::from("Never touched: people you write to, trusted senders, starred,")
            .style(theme::muted()),
    );
    text.push(Line::from("replied-to, recent, and legal/tax/security mail.").style(theme::muted()));
    modal(f, area, " HELP ", text, "any key to close");
}

fn modal(f: &mut Frame, area: Rect, title: &str, mut text: Vec<Line>, keys: &str) -> Rect {
    if !keys.is_empty() {
        text.push(Line::from(""));
        text.push(Line::from(Span::styled(keys.to_string(), theme::key())));
    }
    let height = (text.len() as u16 + 2).min(area.height);
    let [row] = Layout::vertical([Constraint::Length(height)])
        .flex(Flex::Center)
        .areas(area);
    let [rect] = Layout::horizontal([Constraint::Max(64)])
        .flex(Flex::Center)
        .areas(row);
    f.render_widget(Clear, rect);
    let block = Block::bordered()
        .border_type(BorderType::Double)
        .border_style(Style::new().fg(PHOSPHOR))
        .title(Span::styled(title.to_string(), theme::title()))
        .style(Style::new().bg(VOID).fg(BONE));
    f.render_widget(
        Paragraph::new(text).block(block).wrap(Wrap { trim: false }),
        rect,
    );
    rect
}

pub fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn megabytes(bytes: u64) -> String {
    let mb = bytes as f64 / 1_048_576.0;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{mb:.1} MB")
    }
}

fn ago(d: chrono::DateTime<Utc>) -> String {
    let days = (Utc::now() - d).num_days().max(0);
    match days {
        0 => "today".into(),
        1..=59 => format!("{days}d"),
        60..=729 => format!("{}mo", days / 30),
        _ => format!("{}y", days / 365),
    }
}

/// Rows these lines take once wrapped to `width` columns
pub fn wrapped_height(lines: &[Line], width: u16) -> u16 {
    let width = usize::from(width.max(1));
    lines
        .iter()
        .map(|l| l.width().max(1).div_ceil(width) as u16)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_numbers() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(41286), "41,286");
        assert_eq!(thousands(1234567), "1,234,567");
        assert_eq!(megabytes(5 * 1_048_576), "5.0 MB");
    }
}
