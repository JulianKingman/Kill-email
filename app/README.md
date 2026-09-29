# kill-email

The Kill All Email terminal app. It scans an IMAP inbox, groups mail by sender, and moves the senders you pick to Trash, with every move recorded so it can be undone.

This is milestone 1: the Kill List. Unsubscribe, the on-device Laya model, Search & Destroy, Search & Rescue and Terminate come in later milestones.

## Try it

```bash
cargo run --release -- --demo          # made-up inbox, nothing real is touched
```

## Use it on your mail

```bash
cargo run --release -- init            # writes a settings file and prints where
# edit it: host, username (Gmail needs an app password)
cargo run --release                    # asks for your password, then scans
cargo run --release -- --dry-run       # same, but nothing is moved
```

Set `KILL_EMAIL_PASSWORD` to skip the password prompt. The password is never written to disk.

Keys: `space` mark a sender, `enter` terminate (asks first), `u` undo the last batch, `s` sort, `r` rescan, `?` help, `q` quit.

Other commands:

```bash
kill-email scan --top 25     # print the loudest senders without the interface
kill-email undo --list       # list past batches
kill-email undo [BATCH]      # put a batch back (default: the most recent)
```

## What it never deletes

- Anyone you have sent mail to (learned from your Sent folder)
- Senders under `trusted` in the settings
- Starred or flagged mail, and mail you replied to
- Mail newer than `recent_days` (14 by default), or with no date
- Subjects mentioning legal notices, courts, taxes, the IRS, security alerts or password resets
- Mail without a Message-ID, because it could not be found again to undo

Everything else it moves goes to your Trash, never straight to deletion. The undo journal lives in your data folder (`journal.jsonl`), and undo finds each message again by its exact Message-ID.

Only headers are read (From, Date, Subject, Message-ID and the mailing-list headers). Message bodies are never downloaded.

## Develop

```bash
cargo test                           # unit tests
cargo run --example snapshot -- 120 36 board > board.html   # render a screen to HTML
```

The IMAP integration test runs against a real server when `KILL_EMAIL_TEST_IMAP=host:port:user:password` is set. It wipes and reseeds that account with `tests/fixtures/seed_imap.py`, so only use a throwaway test account. CI runs it against the Dovecot config in `tests/fixtures/dovecot-test.conf`.
