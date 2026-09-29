//! Sends a real unsubscribe email when `KILL_EMAIL_TEST_SMTP=host:port` points at a
//! throwaway, unencrypted SMTP server on this machine (CI runs a sink for it).

use kill_email::config::{Account, Security, Smtp};
use kill_email::mail::Unsubscribe;
use kill_email::unsubscribe::{Live, Method, unsubscribe};

#[test]
fn sends_an_unsubscribe_email() {
    let Ok(target) = std::env::var("KILL_EMAIL_TEST_SMTP") else {
        eprintln!("KILL_EMAIL_TEST_SMTP not set; skipping");
        return;
    };
    let (host, port) = target.split_once(':').expect("host:port");
    let account = Account {
        host: "127.0.0.1".into(),
        port: 1143,
        username: "tester@example.test".into(),
        security: Security::None,
        inbox: "INBOX".into(),
        trash: None,
        sent: None,
        smtp: Some(Smtp {
            host: host.into(),
            port: port.parse().unwrap(),
            security: Security::None,
        }),
    };
    let how = Unsubscribe {
        https: None,
        mailto: Some("mailto:leave@list.example?subject=unsubscribe%20me".into()),
        one_click: false,
    };
    let mut live = Live::new(&account, "unused");
    assert_eq!(unsubscribe(&how, &mut live).unwrap(), Method::Email);

    if let Ok(log) = std::env::var("KILL_EMAIL_TEST_SMTP_LOG") {
        let received = std::fs::read_to_string(log).unwrap();
        assert!(received.contains("To: leave@list.example"), "{received}");
        assert!(received.contains("Subject: unsubscribe me"), "{received}");
    }
}
