# kill-email

The Kill All Email terminal app. It scans an IMAP inbox, groups mail by sender, and moves the senders you pick to Trash, with every move recorded so it can be undone.

This is the Kill List: sort senders by volume, delete them and unsubscribe from them. Sorting and protection are rule-based for now; the on-device Laya model, Search & Destroy, Search & Rescue and Terminate come in later milestones.

## Get it

macOS or Linux, in a terminal:

```bash
curl -fsSL https://killall.email/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://killall.email/install.ps1 | iex
```

That downloads the latest build, puts `kill-email` in `~/.local/bin` (or `%LOCALAPPDATA%\kill-email` on Windows) and starts it. Run the same line again to update. Add `-s -- --demo` after `sh` to start on the made-up inbox instead, or set `KILL_EMAIL_NO_RUN=1` to install without starting.

The builds are also on the repository's [nightly release](https://github.com/JulianKingman/Kill-email/releases/tag/nightly), or build it yourself with Rust installed: `cargo build --release`, and the binary is `target/release/kill-email`.

## Use it

```bash
./kill-email --demo      # made-up inbox, nothing real is touched
./kill-email             # set up your account, then scan
./kill-email --dry-run   # same, but nothing is moved
```

The first run asks where your mail is (Gmail, iCloud, Yahoo, Fastmail or any IMAP server), your address and an app password, then connects. The password is kept in the system keychain (macOS Keychain, Windows Credential Manager, or the Secret Service on Linux), never in a file. Press `,` any time to change settings: your account, how recent mail must be to stay untouched, how much of the inbox to scan, and senders never to touch.

Go down the list once, marking each sender:

- `space` marks it ✕ **kill**: its mail goes to Trash. It also marks it ⊘ **unsubscribe** if the sender offers a way out.
- `n` switches ⊘ on or off: press it after `space` for kill only, or on its own to unsubscribe only. That works on protected senders too.
- Both move to the next sender. A dim dot shows where a mark could go.
- `enter` shows everything marked on one confirm screen; `y` does it all. With nothing marked, it acts on the highlighted sender.

Other keys: `a` accept suggestions, `i` ignore a suggestion, `u` undo the last batch, `s` sort, `r` rescan, `,` settings, `?` help, `q` quit.

In settings you can turn off "Unsubscribe on kill", and switch the icons to a trash can and a crossed-out person if your terminal uses a [Nerd Font](https://www.nerdfonts.com).

## Suggestions

The Kill List suggests what to do about each sender, shown as grey marks. Press `a` to mark everything suggested (you still check and confirm with `enter`), `i` to never suggest anything for a sender again, or `s` to sort suggestions first. The right-hand pane says why:

- **Unsubscribe**: marketing, social nudges, newsletters and other bulk mail you ignore. That's opening 10% or less, nothing opened in 90 days, or binning several unread (it reads the newest 2,000 messages in Trash).
- **Clear out, stay subscribed**: notifications about things you did (GitHub, receipts, bookings) that pile up unread. You'd want the next one, just not the old ones.
- **Clear out**: ignored bulk mail with no way to unsubscribe.

It never suggests anything for people you write to, senders on your "Never touch" list, anyone you've replied to, senders whose mail you often star, personal mail, or mail you open half the time or more. It needs at least 5 messages to judge by.

What kind of mail a sender sends comes from headers only: known bulk-mail services (Mailchimp, Klaviyo, Substack and others), notification headers such as GitHub's, social networks, and wording in subjects. The on-device model will refine the unclear cases in a later milestone.

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

Only headers are read (From, Date, Subject, Message-ID, the mailing-list headers, and a few that identify bulk-mail services and notifications). Message bodies are never downloaded.

## Develop

```bash
cargo test                           # unit tests
cargo run --example snapshot -- 120 36 board > board.html   # render a screen to HTML
```

Screens for the snapshot example: `board`, `confirm`, `scanning`, `working`, `help`, `setup`, `setup-form`, `settings`; an optional fourth argument sets the animation frame.

The IMAP integration test runs against a real server when `KILL_EMAIL_TEST_IMAP=host:port:user:password` is set. It wipes and reseeds that account with `tests/fixtures/seed_imap.py`, so only use a throwaway test account. CI runs it against the Dovecot config in `tests/fixtures/dovecot-test.conf`.
