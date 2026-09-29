//! Append-only record of every message moved, so any batch can be put back.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Record {
    Moved(Moved),
    Undone { batch: String, at: DateTime<Utc> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Moved {
    pub batch: String,
    pub at: DateTime<Utc>,
    pub sender: String,
    pub message_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Batch {
    pub id: String,
    pub at: DateTime<Utc>,
    pub messages: usize,
    pub senders: Vec<String>,
    pub undone: bool,
}

pub struct Journal {
    path: PathBuf,
}

impl Journal {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn append(&self, records: &[Record]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .with_context(|| {
                format!(
                    "could not write the undo journal at {}",
                    self.path.display()
                )
            })?;
        let mut buf = String::new();
        for r in records {
            buf.push_str(&serde_json::to_string(r)?);
            buf.push('\n');
        }
        file.write_all(buf.as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    pub fn records(&self) -> Result<Vec<Record>> {
        let file = match fs::File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            // A torn last line from a crash is skipped rather than blocking every undo
            if let Ok(r) = serde_json::from_str(&line) {
                out.push(r);
            }
        }
        Ok(out)
    }

    /// Batches, newest first
    pub fn batches(&self) -> Result<Vec<Batch>> {
        let mut map: BTreeMap<String, Batch> = BTreeMap::new();
        for r in self.records()? {
            match r {
                Record::Moved(m) => {
                    let b = map.entry(m.batch.clone()).or_insert_with(|| Batch {
                        id: m.batch.clone(),
                        at: m.at,
                        messages: 0,
                        senders: Vec::new(),
                        undone: false,
                    });
                    b.messages += 1;
                    if !b.senders.contains(&m.sender) {
                        b.senders.push(m.sender);
                    }
                }
                Record::Undone { batch, .. } => {
                    if let Some(b) = map.get_mut(&batch) {
                        b.undone = true;
                    }
                }
            }
        }
        let mut out: Vec<Batch> = map.into_values().collect();
        out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
        Ok(out)
    }

    pub fn moved_in(&self, batch: &str) -> Result<Vec<Moved>> {
        Ok(self
            .records()?
            .into_iter()
            .filter_map(|r| match r {
                Record::Moved(m) if m.batch == batch => Some(m),
                _ => None,
            })
            .collect())
    }
}
