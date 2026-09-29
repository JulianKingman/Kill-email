//! The terminal interface.

pub mod app;
pub mod input;
pub mod march;
pub mod settings;
pub mod setup;
pub mod theme;
pub mod ui;
pub mod worker;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyEventKind};
use crossterm::execute;

use crate::journal::Journal;
use crate::mail::{ImapStore, MailStore};
use crate::secrets;
use app::{App, Effect, Tone};
use worker::Worker;

/// What the event loop needs to carry out effects
pub struct Runtime {
    pub config_path: PathBuf,
    pub journal: Journal,
    pub dry_run: bool,
}

/// A mail connection for a real account, opened on the worker thread
pub fn imap_worker(account: crate::config::Account, password: String, rt: &Runtime) -> Worker {
    let channels = Box::new(crate::unsubscribe::Live::new(&account, &password));
    Worker::spawn(
        Box::new(move || {
            Ok(Box::new(ImapStore::connect(&account, &password)?) as Box<dyn MailStore>)
        }),
        channels,
        rt.journal.clone(),
        rt.dry_run,
    )
}

pub fn run(mut app: App, worker: Option<Worker>, rt: Runtime) -> Result<()> {
    let mut terminal = ratatui::init();
    // Pasting an app password should arrive as one piece, not a burst of keystrokes
    let _ = execute!(std::io::stdout(), EnableBracketedPaste);
    let result = event_loop(&mut terminal, &mut app, worker, &rt);
    let _ = execute!(std::io::stdout(), DisableBracketedPaste);
    ratatui::restore();
    result
}

fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    mut worker: Option<Worker>,
    rt: &Runtime,
) -> Result<()> {
    let started = Instant::now();
    while !app.quit {
        // One column every 110 ms: a steady march, not a blur
        app.tick = (started.elapsed().as_millis() / 110) as u64;
        terminal.draw(|f| ui::draw(f, app))?;

        let mut effects = Vec::new();
        if let Some(w) = &worker {
            while let Ok(update) = w.updates.try_recv() {
                effects.extend(app.on_update(update));
            }
        }

        if event::poll(Duration::from_millis(60))? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    effects.extend(app.on_key(key))
                }
                Event::Paste(text) => app.on_paste(&text),
                _ => {}
            }
        }

        for effect in effects {
            apply(effect, app, &mut worker, rt);
        }
    }
    Ok(())
}

fn apply(effect: Effect, app: &mut App, worker: &mut Option<Worker>, rt: &Runtime) {
    match effect {
        Effect::Job(job) => match worker {
            Some(w) if w.jobs.send(job).is_ok() => {}
            _ => app.say("Not connected to your mail server. Press , to check your account", Tone::Warn),
        },
        Effect::Connect { config, password } => {
            // Replacing the worker drops the old connection
            *worker = Some(imap_worker(config.account, password, rt));
        }
        Effect::SaveSettings(config) => {
            if let Err(e) = config.save(&rt.config_path) {
                app.say(format!("Couldn't save settings: {e:#}"), Tone::Warn);
            }
        }
        Effect::StorePassword { username, password } => match secrets::save(&username, &password) {
            Ok(()) => app.password_saved = true,
            Err(e) => app.say(
                format!("Signed in, but the password couldn't be saved to the keychain ({e}). You'll be asked next time"),
                Tone::Warn,
            ),
        },
        Effect::ForgetPassword(username) => {
            if let Err(e) = secrets::forget(&username) {
                app.say(format!("Couldn't remove the saved password: {e}"), Tone::Warn);
            }
        }
    }
}
