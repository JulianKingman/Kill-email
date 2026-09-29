//! The killall.email palette, for terminals with true color.

use crate::config::IconSet;
use ratatui::style::{Color, Modifier, Style};

pub const VOID: Color = Color::Rgb(11, 3, 4);
pub const GLASS: Color = Color::Rgb(22, 7, 9);
pub const PHOSPHOR: Color = Color::Rgb(255, 59, 46);
pub const EMBER: Color = Color::Rgb(140, 29, 21);
pub const AMBER: Color = Color::Rgb(255, 176, 0);
pub const BONE: Color = Color::Rgb(242, 221, 216);
pub const ASH: Color = Color::Rgb(168, 131, 125);
pub const ALIVE: Color = Color::Rgb(125, 255, 122);

pub fn base() -> Style {
    Style::new().fg(BONE).bg(VOID)
}

pub fn title() -> Style {
    Style::new().fg(PHOSPHOR).add_modifier(Modifier::BOLD)
}

pub fn muted() -> Style {
    Style::new().fg(ASH)
}

pub fn border() -> Style {
    Style::new().fg(EMBER)
}

pub fn key() -> Style {
    Style::new().fg(AMBER).add_modifier(Modifier::BOLD)
}

/// Alternate row shading, the terminal's version of scanlines
pub fn row_bg(i: usize) -> Color {
    if i.is_multiple_of(2) { VOID } else { GLASS }
}

pub const LOGO: [&str; 6] = [
    "██╗  ██╗██╗██╗     ██╗          █████╗ ██╗     ██╗         ███████╗███╗   ███╗ █████╗ ██╗██╗     ",
    "██║ ██╔╝██║██║     ██║         ██╔══██╗██║     ██║         ██╔════╝████╗ ████║██╔══██╗██║██║     ",
    "█████╔╝ ██║██║     ██║         ███████║██║     ██║         █████╗  ██╔████╔██║███████║██║██║     ",
    "██╔═██╗ ██║██║     ██║         ██╔══██║██║     ██║         ██╔══╝  ██║╚██╔╝██║██╔══██║██║██║     ",
    "██║  ██╗██║███████╗███████╗    ██║  ██║███████╗███████╗    ███████╗██║ ╚═╝ ██║██║  ██║██║███████╗",
    "╚═╝  ╚═╝╚═╝╚══════╝╚══════╝    ╚═╝  ╚═╝╚══════╝╚══════╝    ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝",
];

/// The Target Lock mark in text: an envelope inside corner brackets
pub const MARK: &str = "⌜✉⌟";

/// The two marks a sender can carry, one column each
#[derive(Clone, Copy)]
pub struct Icons {
    /// Its mail goes to Trash
    pub kill: &'static str,
    /// Unsubscribe from it
    pub leave: &'static str,
}

pub fn icons(set: IconSet) -> Icons {
    match set {
        // Both are in common coding fonts, so the terminal doesn't substitute them
        IconSet::Symbols => Icons {
            kill: "✕",
            leave: "⊘",
        },
        // Font Awesome glyphs in Nerd Fonts: trash can, and a person crossed out
        IconSet::NerdFont => Icons {
            kill: "\u{f1f8}",
            leave: "\u{f235}",
        },
    }
}
