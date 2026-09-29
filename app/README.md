# kill-email

The Kill All Email terminal app. It scans an IMAP inbox, groups mail by sender, and moves the senders you pick to Trash, with every move recorded so it can be undone.

This is the Kill List: sort senders by volume, delete them and unsubscribe from them. Sorting and protection are rule-based for now; the on-device Laya model, Search & Destroy, Search & Rescue and Terminate come in later milestones.

## Get it

Download a build from the repository's Actions tab (the latest **release** run, under Artifacts), or from Releases once there is one:

- **macOS** (Apple Silicon and Intel): `kill-email-macos.tar.gz`
- **Linux** (x86_64): `kill-email-linux-x86_64.tar.gz`
- **Windows** (x86_64): `kill-email-windows-x86_64.zip`

On macOS the build isn't signed yet, so the first time, clear the download flag before running it:

```bash
tar -xzf kill-email-macos.tar.gz
xattr -d com.apple.quarantine kill-email
./kill-email
```

Or build it yourself with Rust installed: `cargo build --release`, and the binary is `target/release/kill-email`.

## Use it

```bash
./kill-email --demo      # made-up inbox, nothing real is touched
./kill-email             # set up your account, then scan
./kill-email --dry-run   # same, but nothing is moved
```

The first run asks where your mail is (Gmail, iCloud, Yahoo, Fastmail or any IMAP server), your address and an app password, then connects. The password is kept in the system keychain (macOS Keychain, Windows Credential Manager, or the Secret Service on Linux), never in a file. Press `,` any time to change settings: your account, how recent mail must be to stay untouched, how much of the inbox to scan, and senders never to touch.

Go down the list once, marking each sender:

- `space` marks it ✖ **kill**: its mail goes to Trash. It also marks it 🚷 **unsubscribe** if the sender offers a way out.
- `n` switches 🚷 on or off: press it after `space` for kill only, or on its own to unsubscribe only. That works on protected senders too.
- Both move to the next sender. A dim dot shows where a mark could go.
- `enter` shows everything marked on one confirm screen; `y` does it all. With nothing marked, it acts on the highlighted sender.

Other keys: `u` undo the last batch, `s` sort, `r` rescan, `,` settings, `?` help, `q` quit. If you'd rather `space` didn't unsubscribe too, turn off "Space also unsubscribes" in settings.

The right-hand pane shows the highlighted sender's newest messages (unread ones marked with a dot) so you can see what you're about to delete.

## Unsubscribing

It uses the sender's own List-Unsubscribe header, best method first:

1. **One click** (RFC 8058): a single HTTPS request, no page to visit.
2. **Email**: an unsubscribe email sent from your account, through your provider's outgoing server with the same app password.
3. **Web page**: opened in your browser for you to finish.

Unsubscribing can't be undone. Senders you've left show `✔ done`, and that's remembered between runs.

## What it never deletes

- Anyone you have sent mail to (learned from your Sent folder)
- Senders you add under "Never touch" in settings
- Starred or flagged mail, and mail you replied to
- Mail newer than the "Keep mail newer than" setting (14 days by default), or with no date
- Subjects mentioning legal notices, courts, taxes, the IRS, security alerts or password resets
- Mail without a Message-ID, because it could not be found again to undo

Everything else it moves goes to your Trash, never straight to deletion. The undo journal lives in your data folder (`journal.jsonl`), and undo finds each message again by its exact Message-ID.

Only headers are read (From, Date, Subject, Message-ID and the mailing-list headers). Message bodies are never downloaded.

## Develop

```bash
cargo test                           # unit tests
cargo run --example snapshot -- 120 36 board > board.html   # render a screen to HTML
```

Screens for the snapshot example: `board`, `confirm`, `scanning`, `working`, `help`, `setup`, `setup-form`, `settings`; an optional fourth argument sets the animation frame.

The IMAP integration test runs against a real server when `KILL_EMAIL_TEST_IMAP=host:port:user:password` is set. It wipes and reseeds that account with `tests/fixtures/seed_imap.py`, so only use a throwaway test account. CI runs it against the Dovecot config in `tests/fixtures/dovecot-test.conf`.
