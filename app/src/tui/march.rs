//! The loading animation: a squad of pixel robots marching across the inbox, stomping mail.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::widgets::Widget;

use super::theme::{AMBER, ASH, EMBER, PHOSPHOR};

const WIDTH: u16 = 7;
/// Robot rows plus the ground row
pub const HEIGHT: u16 = 6;
const SPACING: u16 = 13;
const ENVELOPE_EVERY: u16 = 4;

/// Each robot row is (glyphs, paint): r = body, d = shadow, e = eye, space = transparent
const HEAD: [(&str, &str); 4] = [
    (" ▄▄▄▄▄ ", " rrrrr "),
    ("▐█▀█▀█▌", "rrererr"),
    (" ▀███▀ ", " rrrrr "),
    ("▗▟▓█▓▙▖", "rrdrdrr"),
];
const STRIDE: (&str, &str) = (" ▟▘ ▝▙ ", " rr rr ");
const PASS: (&str, &str) = ("  ▐█▌  ", "  rrr  ");

pub struct March {
    /// Animation clock; each step moves the squad one column
    pub tick: u64,
}

impl March {
    /// Left edges of the robots on screen, and which leg pose each one is in
    fn robots(&self, width: u16) -> Vec<(i32, bool)> {
        let lane = u64::from(width + SPACING);
        let count = (width + SPACING) / SPACING;
        (0..count)
            .map(|i| {
                let x = (self.tick + u64::from(i * SPACING)) % lane;
                let stride = (self.tick / 2 + u64::from(i)).is_multiple_of(2);
                (x as i32 - i32::from(WIDTH), stride)
            })
            .collect()
    }
}

impl Widget for March {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height < HEIGHT || area.width < WIDTH {
            return;
        }
        let robots = self.robots(area.width);

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
                c > x && c < x + i32::from(WIDTH) - 1
            });
            if stomped {
                cell.set_symbol("✖")
                    .set_style(Style::new().fg(PHOSPHOR).add_modifier(Modifier::BOLD));
            } else {
                cell.set_symbol("✉").set_style(Style::new().fg(ASH));
            }
        }

        for (x, stride) in robots {
            let legs = if stride { STRIDE } else { PASS };
            for (row, (glyphs, paint)) in HEAD.iter().chain(std::iter::once(&legs)).enumerate() {
                for (i, (g, p)) in glyphs.chars().zip(paint.chars()).enumerate() {
                    let col = x + i as i32;
                    if p == ' ' || col < 0 || col >= i32::from(area.width) {
                        continue;
                    }
                    let style = match p {
                        'e' => Style::new().fg(AMBER).bg(PHOSPHOR),
                        'd' => Style::new().fg(EMBER),
                        _ => Style::new().fg(PHOSPHOR),
                    };
                    let pos = (area.x + col as u16, area.y + row as u16);
                    if let Some(cell) = buf.cell_mut(pos) {
                        cell.set_symbol(&g.to_string()).set_style(style);
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
        for (glyphs, paint) in HEAD.iter().chain([&STRIDE, &PASS]) {
            assert_eq!(glyphs.chars().count(), WIDTH as usize, "{glyphs:?}");
            assert_eq!(paint.chars().count(), WIDTH as usize, "{paint:?}");
        }
    }

    #[test]
    fn squad_marches_and_wraps() {
        let a = March { tick: 0 }.robots(60);
        let b = March { tick: 1 }.robots(60);
        assert_eq!(a.len(), b.len());
        assert!(a.len() >= 4, "enough robots to fill the lane");
        assert_eq!(b[0].0, a[0].0 + 1, "one column per tick");
        let far = March { tick: 60 + 13 }.robots(60);
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
