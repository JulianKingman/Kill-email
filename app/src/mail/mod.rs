//! What the app knows about a message, and the mailbox operations it needs.

mod fake;
mod headers;
mod imap;
pub mod kind;

use std::collections::HashSet;

use anyhow::Result;
use chrono::{DateTime, Utc};

pub use fake::FakeStore;
pub use headers::{parse_meta, parse_recipients};
pub use imap::ImapStore;
pub use kind::Kind;

/// Headers fetched for every scanned message. Bodies are never downloaded.
pub const SCAN_HEADERS: &str = "FROM DATE SUBJECT MESSAGE-ID LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST \
     LIST-ID PRECEDENCE AUTO-SUBMITTED FEEDBACK-ID X-MAILER X-GITHUB-REASON X-GITLAB-PROJECT \
     X-JIRA-FINGERPRINT";

#[derive(Debug, Clone, PartialEq)]
pub struct MessageMeta {
    pub uid: u32,
    pub message_id: Option<String>,
    /// Lower-cased sender address
    pub from: String,
    pub from_name: Option<String>,
    pub subject: String,
    pub date: Option<DateTime<Utc>>,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub size: u32,
    pub unsubscribe: Unsubscribe,
    /// Sent through a mailing list or bulk sender
    pub bulk: bool,
    pub kind: Kind,
    /// The bulk-mail service that sent it, if recognised
    pub platform: Option<&'static str>,
}

/// How a sender says you can unsubscribe (RFC 2369 and RFC 8058)
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Unsubscribe {
    pub https: Option<String>,
    pub mailto: Option<String>,
    /// `List-Unsubscribe-Post: List-Unsubscribe=One-Click` with an https link
    pub one_click: bool,
}

impl Unsubscribe {
    pub fn is_empty(&self) -> bool {
        self.https.is_none() && self.mailto.is_none()
    }

    pub fn label(&self) -> &'static str {
        if self.one_click {
            "1-click"
        } else if self.mailto.is_some() {
            "mailto"
        } else if self.https.is_some() {
            "web link"
        } else {
            "none"
        }
    }

    /// Rank used to pick the best method across a sender's messages
    pub fn rank(&self) -> u8 {
        match self.label() {
            "1-click" => 3,
            "mailto" => 2,
            "web link" => 1,
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folders {
    pub inbox: String,
    pub trash: String,
    pub sent: Option<String>,
}

pub trait MailStore {
    /// Find the inbox, Trash and Sent folders
    fn folders(&mut self) -> Result<Folders>;

    /// Headers and flags for messages in `folder`, newest first
    fn scan(
        &mut self,
        folder: &str,
        limit: usize,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<Vec<MessageMeta>>;

    /// Every address you have sent mail to, from the newest `limit` messages in `folder`
    fn sent_recipients(&mut self, folder: &str, limit: usize) -> Result<HashSet<String>>;

    /// Move messages between folders
    fn move_messages(&mut self, from: &str, uids: &[u32], to: &str) -> Result<()>;

    /// UID of the message with this Message-ID in `folder`, if it is there
    fn find_by_message_id(&mut self, folder: &str, message_id: &str) -> Result<Option<u32>>;
}

/// Compress UIDs into an IMAP sequence set such as `1:4,7,9:10`
pub fn uid_set(uids: &[u32]) -> String {
    let mut sorted = uids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut parts = Vec::new();
    let mut i = 0;
    while i < sorted.len() {
        let start = sorted[i];
        let mut end = start;
        while i + 1 < sorted.len() && sorted[i + 1] == end + 1 {
            i += 1;
            end = sorted[i];
        }
        parts.push(if start == end {
            start.to_string()
        } else {
            format!("{start}:{end}")
        });
        i += 1;
    }
    parts.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uid_sets_compress_runs() {
        assert_eq!(uid_set(&[9, 1, 2, 3, 4, 7, 10, 3]), "1:4,7,9:10");
        assert_eq!(uid_set(&[5]), "5");
        assert_eq!(uid_set(&[]), "");
    }
}
