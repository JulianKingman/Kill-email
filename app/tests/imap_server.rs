//! Runs against a real IMAP server seeded by `tests/fixtures/seed_imap.py`.
//!
//! Skipped unless KILL_EMAIL_TEST_IMAP is set, e.g.
//! `KILL_EMAIL_TEST_IMAP=127.0.0.1:1143:tester:testpass cargo test --test imap_server`

use std::collections::HashSet;

use chrono::Utc;
use kill_email::config::{Account, Safety, Security};
use kill_email::journal::Journal;
use kill_email::mail::{ImapStore, MailStore};
use kill_email::ops::{terminate, undo};
use kill_email::safety::{Hold, SafetyRules};
use kill_email::senders::group_by_sender;

fn server() -> Option<(Account, String)> {
    let spec = std::env::var("KILL_EMAIL_TEST_IMAP").ok()?;
    let parts: Vec<&str> = spec.splitn(4, ':').collect();
    let [host, port, user, pass] = parts[..] else {
        panic!("KILL_EMAIL_TEST_IMAP must be host:port:user:password");
    };
    let account = Account {
        host: host.into(),
        port: port.parse().unwrap(),
        username: user.into(),
        security: Security::None,
        inbox: "INBOX".into(),
        trash: None,
        sent: None,
    };
    Some((account, pass.into()))
}

fn seed(account: &Account, password: &str) {
    let status = std::process::Command::new("python3")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/seed_imap.py"
        ))
        .args([
            &account.host,
            &account.port.to_string(),
            &account.username,
            password,
        ])
        .status()
        .expect("python3 is needed to seed the test server");
    assert!(status.success(), "seeding failed");
}

#[test]
fn scan_terminate_and_undo_on_a_real_server() {
    let Some((account, password)) = server() else {
        eprintln!("skipped: set KILL_EMAIL_TEST_IMAP to run against a real IMAP server");
        return;
    };
    seed(&account, &password);

    let mut store = ImapStore::connect(&account, &password).expect("connect");
    let folders = store.folders().expect("folders");
    assert_eq!(folders.trash, "Trash", "found Trash through SPECIAL-USE");
    assert_eq!(folders.sent.as_deref(), Some("Sent"));

    let mut calls = 0;
    let msgs = store
        .scan(&folders.inbox, 0, &mut |_, _| calls += 1)
        .expect("scan");
    assert_eq!(msgs.len(), 65);
    assert!(calls >= 2, "progress is reported");

    let sent = store
        .sent_recipients(folders.sent.as_deref().unwrap(), 100)
        .expect("sent");
    assert!(sent.contains("mom@family.test"));

    let rules = SafetyRules::new(&Safety::default(), sent, Utc::now());
    let groups = group_by_sender(&msgs, &rules);

    let shop = groups
        .iter()
        .find(|g| g.address == "deals@shopmart.test")
        .unwrap();
    assert_eq!(shop.total, 30);
    assert_eq!(shop.unsubscribe.label(), "1-click");
    assert_eq!(shop.held.get(&Hold::Flagged), Some(&1));
    assert_eq!(shop.held.get(&Hold::Recent), Some(&1));
    assert_eq!(shop.held.get(&Hold::Sensitive), Some(&1));
    assert_eq!(shop.held.get(&Hold::Unrestorable), Some(&1));
    assert_eq!(shop.targets.len(), 26);

    let brief = groups
        .iter()
        .find(|g| g.address == "digest@dailybrief.test")
        .unwrap();
    assert_eq!(brief.unsubscribe.label(), "mailto");
    assert_eq!(brief.held.get(&Hold::Answered), Some(&1));

    let social = groups
        .iter()
        .find(|g| g.address == "notify@socialnet.test")
        .unwrap();
    assert!(social.bulk);
    assert_eq!(social.unsubscribe.label(), "web link");

    let mom = groups
        .iter()
        .find(|g| g.address == "mom@family.test")
        .unwrap();
    assert_eq!(mom.protected, Some(Hold::Correspondent));

    // Terminate ShopMart and The Daily Brief
    let dir = std::env::temp_dir().join(format!("kill-email-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let journal = Journal::new(dir.join("journal.jsonl"));
    let chosen: Vec<_> = groups
        .iter()
        .filter(|g| g.address == "deals@shopmart.test" || g.address == "digest@dailybrief.test")
        .cloned()
        .collect();
    let expected = chosen.iter().map(|g| g.targets.len()).sum::<usize>();
    let out = terminate(
        &mut store,
        &folders,
        &chosen,
        &journal,
        false,
        &mut |_, _| {},
    )
    .unwrap();
    assert_eq!(out.messages, expected);

    let after = store.scan(&folders.inbox, 0, &mut |_, _| {}).unwrap();
    assert_eq!(after.len(), 65 - expected);
    let trash = store.scan(&folders.trash, 0, &mut |_, _| {}).unwrap();
    assert_eq!(trash.len(), expected);
    // Everything protected is still in the inbox
    let left: HashSet<&str> = after.iter().map(|m| m.subject.as_str()).collect();
    for kept in [
        "Starred deal",
        "Flash sale today",
        "Your tax-free weekend receipt",
        "No id here",
        "Issue 0",
    ] {
        assert!(left.contains(kept), "{kept} should have been kept");
    }

    // Undo puts every message back
    let back = undo(&mut store, &journal, &out.batch).unwrap();
    assert_eq!(back.restored, expected);
    assert_eq!(back.missing, 0);
    assert_eq!(
        store.scan(&folders.inbox, 0, &mut |_, _| {}).unwrap().len(),
        65
    );
    assert!(
        store
            .scan(&folders.trash, 0, &mut |_, _| {})
            .unwrap()
            .is_empty()
    );

    store.logout();
    let _ = std::fs::remove_dir_all(&dir);
}
