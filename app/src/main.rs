use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use clap::{Parser, Subcommand};

use kill_email::config::{self, Config};
use kill_email::journal::Journal;
use kill_email::mail::{FakeStore, ImapStore, MailStore};
use kill_email::ops;
use kill_email::safety::SafetyRules;
use kill_email::secrets;
use kill_email::senders::group_by_sender;
use kill_email::tui::{self, Runtime, app::App, setup::Setup, ui::thousands, worker::Worker};

/// Find the junk in your inbox and move it to Trash, without touching what matters.
///
/// Run with no arguments to set up your account and start.
#[derive(Parser)]
#[command(name = "kill-email", version)]
struct Cli {
    /// Use a different settings file (for testing)
    #[arg(long, global = true, hide = true)]
    config: Option<PathBuf>,

    /// Show what would happen without moving any mail
    #[arg(long, global = true)]
    dry_run: bool,

    /// Try the interface on a made-up inbox; no account needed
    #[arg(long)]
    demo: bool,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Scan without the interface and print the loudest senders
    Scan {
        /// How many senders to list
        #[arg(long, default_value_t = 25)]
        top: usize,
    },
    /// Put a terminated batch back where it came from
    Undo {
        /// Batch to restore (default: the most recent one)
        batch: Option<String>,
        /// List batches instead of restoring one
        #[arg(long)]
        list: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let config_path = match &cli.config {
        Some(p) => p.clone(),
        None => config::default_config_path()?,
    };

    match cli.command {
        Some(Command::Scan { top }) => scan(&config_path, top),
        Some(Command::Undo { batch, list }) => undo(&config_path, batch, list),
        None if cli.demo => run_demo(cli.dry_run),
        None => run_tui(&config_path, cli.dry_run),
    }
}

/// For the command-line tools: the saved password, or ask for it
fn password(config: &Config) -> Result<String> {
    if let Some(p) = secrets::load(&config.account.username) {
        return Ok(p);
    }
    rpassword::prompt_password(format!("Password for {}: ", config.account.username))
        .context("could not read the password")
}

fn load_config(path: &Path) -> Result<Config> {
    if !path.exists() {
        bail!("no account set up yet. Run `kill-email` to set one up");
    }
    Config::load(path)
}

fn connect(config: &Config) -> Result<ImapStore> {
    let pw = password(config)?;
    ImapStore::connect(&config.account, &pw)
}

fn run_tui(config_path: &Path, dry_run: bool) -> Result<()> {
    let journal = Journal::new(config::journal_path()?);
    let last = journal.batches()?.into_iter().find(|b| !b.undone);
    let rt = Runtime {
        config_path: config_path.to_path_buf(),
        journal,
        dry_run,
    };

    let saved = if config_path.exists() {
        Some(Config::load(config_path)?)
    } else {
        None
    };
    let (app, worker) = match saved {
        Some(config) => match secrets::load(&config.account.username) {
            Some(password) => {
                let worker = tui::imap_worker(config.account.clone(), password, &rt);
                let from_keychain = std::env::var("KILL_EMAIL_PASSWORD").is_err();
                (
                    App::connected(config, from_keychain, dry_run, false, last),
                    Some(worker),
                )
            }
            None => {
                let setup = Setup::ask_password(config.clone(), None);
                (App::needs_setup(setup, Some(config), dry_run, last), None)
            }
        },
        None => (
            App::needs_setup(Setup::new(None), None, dry_run, last),
            None,
        ),
    };
    tui::run(app, worker, rt)
}

fn run_demo(dry_run: bool) -> Result<()> {
    // A private journal, so demo undo works without mixing with real batches
    let journal = Journal::new(
        std::env::temp_dir().join(format!("kill-email-demo-{}.jsonl", std::process::id())),
    );
    let worker = Worker::spawn(
        Box::new(|| Ok(Box::new(FakeStore::demo()) as Box<dyn MailStore>)),
        journal.clone(),
        dry_run,
    );
    let rt = Runtime {
        config_path: std::env::temp_dir().join("kill-email-demo-settings.toml"),
        journal,
        dry_run,
    };
    let config = Config::new_account("", 993, "", config::Security::Tls);
    tui::run(
        App::connected(config, false, dry_run, true, None),
        Some(worker),
        rt,
    )
}

fn scan(config_path: &Path, top: usize) -> Result<()> {
    let config = load_config(config_path)?;
    let mut store = connect(&config)?;
    let folders = store.folders()?;
    let sent = match &folders.sent {
        Some(s) => store.sent_recipients(s, config.safety.sent_scan_limit)?,
        None => Default::default(),
    };
    let msgs = store.scan(
        &folders.inbox,
        config.safety.scan_limit,
        &mut |done, total| {
            eprint!("\rScanning {} / {}", thousands(done), thousands(total));
        },
    )?;
    eprintln!();
    let rules = SafetyRules::new(&config.safety, sent, Utc::now());
    let groups = group_by_sender(&msgs, &rules);

    println!(
        "{:<40} {:>7} {:>5} {:<9} VERDICT",
        "SENDER", "EMAILS", "READ", "UNSUB"
    );
    for g in groups.iter().take(top) {
        let verdict = match g.protected {
            Some(h) => format!("protected: {}", h.label()),
            None => format!("target {} ({} held)", g.targets.len(), g.held_total()),
        };
        println!(
            "{:<40} {:>7} {:>4}% {:<9} {verdict}",
            truncate(&g.address, 40),
            thousands(g.total),
            g.read_pct(),
            g.unsubscribe.label()
        );
    }
    println!(
        "\n{} messages from {} senders in {}",
        thousands(msgs.len()),
        thousands(groups.len()),
        folders.inbox
    );
    store.logout();
    Ok(())
}

fn undo(config_path: &Path, batch: Option<String>, list: bool) -> Result<()> {
    let journal = Journal::new(config::journal_path()?);
    let batches = journal.batches()?;
    if list {
        if batches.is_empty() {
            println!("Nothing has been terminated yet.");
        }
        for b in &batches {
            println!(
                "{}  {:>6} messages  {}{}",
                b.id,
                thousands(b.messages),
                b.senders.join(", "),
                if b.undone { "  (undone)" } else { "" }
            );
        }
        return Ok(());
    }
    let id = match batch {
        Some(id) => id,
        None => batches
            .iter()
            .find(|b| !b.undone)
            .map(|b| b.id.clone())
            .context("nothing to undo")?,
    };
    let config = load_config(config_path)?;
    let mut store = connect(&config)?;
    let r = ops::undo(&mut store, &journal, &id)?;
    println!(
        "Restored {} messages from batch {}.",
        thousands(r.restored),
        r.batch
    );
    if r.missing > 0 {
        println!(
            "{} were no longer in Trash and could not be restored.",
            thousands(r.missing)
        );
    }
    store.logout();
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max - 1).collect::<String>())
    }
}
