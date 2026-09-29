//! The terminal interface.

pub mod app;
pub mod march;
pub mod theme;
pub mod ui;
pub mod worker;

use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{self, Event, KeyEventKind};

use app::App;
use worker::{Job, Worker};

pub fn run(mut app: App, worker: Worker) -> Result<()> {
    worker.jobs.send(Job::Scan)?;
    let mut terminal = ratatui::init();
    let result = event_loop(&mut terminal, &mut app, &worker);
    ratatui::restore();
    result
}

fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    worker: &Worker,
) -> Result<()> {
    let started = Instant::now();
    while !app.quit {
        // One column every 110 ms: a brisk march, not a blur
        app.tick = (started.elapsed().as_millis() / 110) as u64;
        terminal.draw(|f| ui::draw(f, app))?;

        while let Ok(update) = worker.updates.try_recv() {
            let rescan = matches!(update, worker::Update::Undone(_));
            app.on_update(update);
            if rescan {
                worker.jobs.send(Job::Scan)?;
            }
        }

        if event::poll(Duration::from_millis(60))?
            && let Event::Key(key) = event::read()?
            && key.kind == KeyEventKind::Press
            && let Some(job) = app.on_key(key)
        {
            worker.jobs.send(job)?;
        }
    }
    Ok(())
}
