//! The loading animation: a squad of pixel robots marching across the inbox, stomping mail.
//!
//! The robots are drawn as real pixel art: two pixels per terminal cell using half blocks,
//! the top pixel as the glyph colour and the bottom one as the background.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::Widget;

use super::theme::{ASH, BONE, EMBER, PHOSPHOR};

const WIDTH: u16 = 19;
/// Robot cells (two pixel rows each) plus the ground row
pub const HEIGHT: u16 = (HEAD.len() + BODY.len() + 3) as u16 / 2 + 1;
const SPACING: u16 = 26;
const ENVELOPE_EVERY: u16 = 3;

/// One character per pixel:
/// . clear, K plate, H shadow, L lit edge, D plating, E eye, T fang, C claw
const HEAD: [&str; 8] = [
    ".........E.........",
    ".........K.........",
    "....KKKKKKKKKKK....",
    "....KLEHHHHHEHK....",
    "....KLEEHHHEEHK....",
    ".K..KLHEEHEEHHK..K.",
    ".K..KLTKTKTKTHK..K.",
    ".K...KKKKKKKKK...K.",
];
/// The claws beside the eyes, open or snapped shut; the right one is mirrored
const CLAWS_OPEN: [&str; 2] = ["C.C", "CKC"];
const CLAWS_SHUT: [&str; 2] = [".C.", "CKC"];
const CLAW_ROW: usize = 3;
const BODY: [&str; 7] = [
    ".KK.KKKKKKKKKKK.KK.",
    "..KKKLDHDHDHDHKKK..",
    "...KLDHDHDHDHDHK...",
    "...KLHDHDHDHDHDK...",
    "...KLDHDHDHDHDHK...",
    "....KLHDHDHDHDK....",
    ".....KKKKKKKKK.....",
];
const STRIDE: [&str; 3] = [
    "......KL...KH......",
    ".....KL.....KH.....",
    "....KKKK...KKKK....",
];
const PASS: [&str; 3] = [
    ".......KL.KH.......",
    ".......KL.KH.......",
    "......KKK.KKK......",
];

const PLATE: Color = Color::Rgb(96, 20, 16);
const SHADOW: Color = Color::Rgb(46, 10, 9);
const PLATING: Color = Color::Rgb(150, 32, 24);
const LIT: Color = Color::Rgb(205, 60, 45);
const EYE_FLARE: Color = Color::Rgb(255, 170, 140);

pub struct March {
    /// Animation clock; each step moves the squad one column
    pub tick: u64,
}

/// Left edges of the robots on screen, and which leg pose each one is in
fn robots(tick: u64, width: u16) -> Vec<(i32, bool)> {
    let lane = u64::from(width + SPACING);
    let count = (width + SPACING) / SPACING;
    // Lockstep: the whole squad moves its legs together
    let stride = (tick / 2).is_multiple_of(2);
    (0..count)
        .map(|i| {
            let x = (tick + u64::from(i * SPACING)) % lane;
            (x as i32 - i32::from(WIDTH), stride)
        })
        .collect()
}

/// The full pixel grid for one frame of a robot
fn sprite(stride: bool) -> Vec<String> {
    let legs = if stride { STRIDE } else { PASS };
    let mut rows: Vec<String> = HEAD
        .iter()
        .chain(&BODY)
        .chain(&legs)
        .map(|r| r.to_string())
        .collect();
    // Claws flank the fangs and the jaw, snapping in time with the march
    let claws = if stride { CLAWS_OPEN } else { CLAWS_SHUT };
    let inner = 3..WIDTH as usize - 3;
    for (row, claw) in rows[CLAW_ROW..].iter_mut().zip(claws) {
        let mirror: String = claw.chars().rev().collect();
        *row = format!("{claw}{}{mirror}", &row[inner.clone()]);
    }
    rows
}

impl March {
    fn paint(&self, p: char) -> Option<Color> {
        Some(match p {
            'K' => PLATE,
            'H' => SHADOW,
            'D' => PLATING,
            'L' => LIT,
            // The eyes flare together every couple of seconds
            'E' if self.tick % 18 < 2 => EYE_FLARE,
            'E' => PHOSPHOR,
            'T' => BONE,
            'C' => ASH,
            _ => return None,
        })
    }
}

impl Widget for March {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height < HEIGHT || area.width < WIDTH {
            return;
        }
        let robots = robots(self.tick, area.width);

        // Ground: a row of mail, stomped wherever a robot's feet land
        let ground = area.y + HEIGHT - 1;
        for col in 0..area.width {
            let Some(cell) = buf.cell_mut((area.x + col, ground)) else {
                continue;
            };
            if col % ENVELOPE_EVERY != 1 {
                cell.set_symbol("▁").set_style(Style::new().fg(EMBER));
                continue;
            }
            let stomped = robots.iter().any(|&(x, _)| {
                let c = i32::from(col);
                c > x + 1 && c < x + i32::from(WIDTH) - 2
            });
            if stomped {
                cell.set_symbol("✖")
                    .set_style(Style::new().fg(PHOSPHOR).add_modifier(Modifier::BOLD));
            } else {
                cell.set_symbol("✉").set_style(Style::new().fg(ASH));
            }
        }

        for (x, stride) in robots {
            let pixels = sprite(stride);
            for (cell_row, pair) in pixels.chunks(2).enumerate() {
                let top: Vec<char> = pair[0].chars().collect();
                let bottom: Vec<char> = pair
                    .get(1)
                    .map_or_else(|| vec!['.'; top.len()], |r| r.chars().collect());
                for (i, (&t, &b)) in top.iter().zip(&bottom).enumerate() {
                    let col = x + i as i32;
                    if col < 0 || col >= i32::from(area.width) {
                        continue;
                    }
                    let (glyph, style) = match (self.paint(t), self.paint(b)) {
                        (None, None) => continue,
                        (Some(t), Some(b)) => ("▀", Style::new().fg(t).bg(b)),
                        (Some(t), None) => ("▀", Style::new().fg(t)),
                        (None, Some(b)) => ("▄", Style::new().fg(b)),
                    };
                    let pos = (area.x + col as u16, area.y + cell_row as u16);
                    if let Some(cell) = buf.cell_mut(pos) {
                        cell.set_symbol(glyph).set_style(style);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprite_rows_line_up() {
        for stride in [true, false] {
            let rows = sprite(stride);
            assert_eq!(rows.len() as u16, (HEIGHT - 1) * 2, "fills the robot cells");
            for row in rows {
                assert_eq!(row.chars().count(), WIDTH as usize, "{row:?}");
            }
        }
    }

    #[test]
    fn squad_marches_and_wraps() {
        let a = robots(0, 60);
        let b = robots(1, 60);
        assert_eq!(a.len(), b.len());
        assert!(a.len() >= 3, "enough robots to fill the lane");
        assert_eq!(b[0].0, a[0].0 + 1, "one column per tick");
        let far = robots(60 + u64::from(SPACING), 60);
        assert_eq!(far[0].0, a[0].0, "the lane wraps around");
    }

    #[test]
    fn renders_without_panicking_in_tiny_areas() {
        for w in [0, 3, 7, 20, 200] {
            let area = Rect::new(0, 0, w, HEIGHT);
            let mut buf = Buffer::empty(area);
            March { tick: 5 }.render(area, &mut buf);
        }
    }
}
