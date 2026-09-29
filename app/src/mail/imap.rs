//! [`MailStore`] over a real IMAP connection.

use std::collections::HashSet;

use anyhow::{Context, Result, anyhow, bail};
use imap::types::Flag;
use imap_proto::NameAttribute;
use imap::{ClientBuilder, ConnectionMode, TlsKind};

use super::headers::{Flags, parse_message_id, parse_meta, parse_recipients};
use super::{Folders, MailStore, MessageMeta, SCAN_HEADERS, uid_set};
use crate::config::{Account, Security};

const CHUNK: usize = 500;

pub struct ImapStore {
    session: imap::Session<imap::Connection>,
    account: Account,
    can_move: bool,
    has_uidplus: bool,
}

impl ImapStore {
    pub fn connect(account: &Account, password: &str) -> Result<Self> {
        let mode = match account.security {
            Security::Tls => ConnectionMode::Tls,
            Security::Starttls => ConnectionMode::StartTls,
            Security::None => ConnectionMode::Plaintext,
        };
        let client = ClientBuilder::new(account.host.as_str(), account.port)
            .mode(mode)
            .tls_kind(TlsKind::Rust)
            .connect()
            .with_context(|| format!("could not connect to {}:{}", account.host, account.port))?;
        let mut session = client
            .login(&account.username, password)
            .map_err(|(e, _)| anyhow!("login failed for {}: {e}", account.username))?;
        let caps = session.capabilities()?;
        let can_move = caps.has_str("MOVE");
        let has_uidplus = caps.has_str("UIDPLUS");
        Ok(Self { session, account: account.clone(), can_move, has_uidplus })
    }

    pub fn logout(mut self) {
        let _ = self.session.logout();
    }

    fn all_uids(&mut self, folder: &str, limit: usize) -> Result<Vec<u32>> {
        self.session
            .examine(folder)
            .with_context(|| format!("could not open folder {folder}"))?;
        let mut uids: Vec<u32> = self.session.uid_search("ALL")?.into_iter().collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        if limit > 0 {
            uids.truncate(limit);
        }
        Ok(uids)
    }
}

impl MailStore for ImapStore {
    fn folders(&mut self) -> Result<Folders> {
        let names = self.session.list(Some(""), Some("*"))?;
        let mut trash = None;
        let mut sent = None;
        for name in names.iter() {
            for attr in name.attributes() {
                match attr {
                    NameAttribute::Trash if trash.is_none() => trash = Some(name.name().to_string()),
                    NameAttribute::Sent if sent.is_none() => sent = Some(name.name().to_string()),
                    _ => {}
                }
            }
        }
        let trash = self.account.trash.clone().or(trash).context(
            "could not find your Trash folder. Set `trash = \"...\"` under [account] in the settings",
        )?;
        let sent = self.account.sent.clone().or(sent);
        Ok(Folders { inbox: self.account.inbox.clone(), trash, sent })
    }

    fn scan(
        &mut self,
        folder: &str,
        limit: usize,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<Vec<MessageMeta>> {
        let uids = self.all_uids(folder, limit)?;
        let total = uids.len();
        let query = format!("(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS ({SCAN_HEADERS})])");
        let mut out = Vec::with_capacity(total);
        progress(0, total);
        for chunk in uids.chunks(CHUNK) {
            let fetches = self.session.uid_fetch(uid_set(chunk), &query)?;
            for f in fetches.iter() {
                let Some(uid) = f.uid else { continue };
                let flags = f.flags();
                let meta = parse_meta(
                    uid,
                    f.header().unwrap_or_default(),
                    Flags {
                        seen: flags.contains(&Flag::Seen),
                        flagged: flags.contains(&Flag::Flagged),
                        answered: flags.contains(&Flag::Answered),
                    },
                    f.size.unwrap_or(0),
                );
                out.push(meta);
            }
            progress(out.len(), total);
        }
        out.sort_by(|a, b| b.uid.cmp(&a.uid));
        Ok(out)
    }

    fn sent_recipients(&mut self, folder: &str, limit: usize) -> Result<HashSet<String>> {
        let uids = self.all_uids(folder, limit)?;
        let mut set = HashSet::new();
        for chunk in uids.chunks(CHUNK) {
            let fetches = self
                .session
                .uid_fetch(uid_set(chunk), "(UID BODY.PEEK[HEADER.FIELDS (TO CC BCC)])")?;
            for f in fetches.iter() {
                parse_recipients(f.header().unwrap_or_default(), &mut set);
            }
        }
        Ok(set)
    }

    fn move_messages(&mut self, from: &str, uids: &[u32], to: &str) -> Result<()> {
        if uids.is_empty() {
            return Ok(());
        }
        self.session
            .select(from)
            .with_context(|| format!("could not open folder {from}"))?;
        for chunk in uids.chunks(CHUNK) {
            let set = uid_set(chunk);
            if self.can_move {
                self.session.uid_mv(&set, to)?;
            } else if self.has_uidplus {
                // COPY, then expunge exactly these UIDs so nothing else marked deleted is lost
                self.session.uid_copy(&set, to)?;
                self.session.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")?;
                self.session.uid_expunge(&set)?;
            } else {
                bail!("this server supports neither MOVE nor UIDPLUS, so messages can't be moved safely");
            }
        }
        Ok(())
    }

    fn find_by_message_id(&mut self, folder: &str, message_id: &str) -> Result<Option<u32>> {
        self.session
            .examine(folder)
            .with_context(|| format!("could not open folder {folder}"))?;
        // SEARCH HEADER is a substring match ("1.x@y" also finds "21.x@y"), so search with the
        // angle brackets to narrow it, then confirm each candidate's Message-ID exactly
        let bracketed = format!("<{message_id}>");
        let quoted = bracketed.replace('\\', "\\\\").replace('"', "\\\"");
        let candidates: Vec<u32> = self
            .session
            .uid_search(format!("HEADER Message-ID \"{quoted}\""))?
            .into_iter()
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }
        let fetches = self
            .session
            .uid_fetch(uid_set(&candidates), "(UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")?;
        let exact = fetches
            .iter()
            .filter(|f| {
                parse_message_id(f.header().unwrap_or_default()).as_deref() == Some(message_id)
            })
            .filter_map(|f| f.uid)
            .max();
        Ok(exact)
    }
}
