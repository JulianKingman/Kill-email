/**
 * KILL ALL EMAIL - IMAP Client
 * "I need your emails. Give them to me."
 */

import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import { EventEmitter } from 'events';
import { EmailMessage, EmailAddress, Attachment, EmailConnectionConfig } from '@kill-email/shared';

export interface ImapClientEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  email: (email: EmailMessage) => void;
  progress: (current: number, total: number) => void;
}

export class ImapClient extends EventEmitter {
  private imap: Imap | null = null;
  private config: EmailConnectionConfig;
  private connected = false;

  constructor(config: EmailConnectionConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const imapConfig: Imap.Config = {
        user: this.config.auth.user,
        password: this.config.auth.password || '',
        host: this.config.imap.host,
        port: this.config.imap.port,
        tls: this.config.imap.tls,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      };

      if (this.config.auth.accessToken) {
        imapConfig.xoauth2 = this.generateXOAuth2Token(
          this.config.auth.user,
          this.config.auth.accessToken
        );
      }

      this.imap = new Imap(imapConfig);

      this.imap.once('ready', () => {
        this.connected = true;
        this.emit('connected');
        resolve();
      });

      this.imap.once('error', (err: Error) => {
        this.emit('error', err);
        reject(err);
      });

      this.imap.once('end', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      this.imap.connect();
    });
  }

  private generateXOAuth2Token(user: string, accessToken: string): string {
    const authString = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString('base64');
  }

  async disconnect(): Promise<void> {
    if (this.imap && this.connected) {
      this.imap.end();
      this.connected = false;
    }
  }

  async openMailbox(mailbox: string = 'INBOX'): Promise<Imap.Box> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.openBox(mailbox, false, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });
  }

  async getMailboxes(): Promise<Imap.MailBoxes> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(boxes);
      });
    });
  }

  async fetchEmails(options: {
    mailbox?: string;
    limit?: number;
    offset?: number;
    since?: Date;
    before?: Date;
    unseen?: boolean;
    all?: boolean;
  } = {}): Promise<EmailMessage[]> {
    const {
      mailbox = 'INBOX',
      limit = 100,
      offset = 0,
      since,
      before,
      unseen = false,
      all = false,
    } = options;

    if (!this.imap) {
      throw new Error('Not connected');
    }

    await this.openMailbox(mailbox);

    const searchCriteria: any[] = all ? ['ALL'] : [];
    if (!all) {
      if (unseen) searchCriteria.push('UNSEEN');
      if (since) searchCriteria.push(['SINCE', since]);
      if (before) searchCriteria.push(['BEFORE', before]);
      if (searchCriteria.length === 0) searchCriteria.push('ALL');
    }

    const uids = await this.searchEmails(searchCriteria);

    if (uids.length === 0) {
      return [];
    }

    const selectedUids = uids.slice(offset, offset + limit);
    this.emit('progress', 0, selectedUids.length);

    const emails: EmailMessage[] = [];
    let processed = 0;

    for (const uid of selectedUids) {
      try {
        const email = await this.fetchSingleEmail(uid);
        if (email) {
          emails.push(email);
        }
        processed++;
        this.emit('progress', processed, selectedUids.length);
      } catch (err) {
        console.error(`Failed to fetch email ${uid}:`, err);
      }
    }

    return emails;
  }

  private async searchEmails(criteria: any[]): Promise<number[]> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.search(criteria, (err, uids) => {
        if (err) reject(err);
        else resolve(uids || []);
      });
    });
  }

  private async fetchSingleEmail(uid: number): Promise<EmailMessage | null> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      const fetch = this.imap.fetch([uid], {
        bodies: '',
        struct: true,
      });

      let emailData: EmailMessage | null = null;

      fetch.on('message', (msg, seqno) => {
        let buffer = '';
        let attributes: any = {};

        msg.on('body', (stream, info) => {
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
        });

        msg.once('attributes', (attrs) => {
          attributes = attrs;
        });

        msg.once('end', async () => {
          try {
            const parsed = await simpleParser(buffer);
            emailData = this.parsedToEmailMessage(parsed, uid, attributes);
          } catch (err) {
            console.error('Failed to parse email:', err);
          }
        });
      });

      fetch.once('error', (err) => {
        reject(err);
      });

      fetch.once('end', () => {
        resolve(emailData);
      });
    });
  }

  private parsedToEmailMessage(
    parsed: ParsedMail,
    uid: number,
    attributes: any
  ): EmailMessage {
    const extractAddresses = (addr: any): EmailAddress[] => {
      if (!addr) return [];
      const addrs = Array.isArray(addr) ? addr : [addr];
      return addrs.map((a: any) => ({
        name: a.name,
        address: a.address || '',
      }));
    };

    const getAddressValue = (field: any): any => {
      if (!field) return undefined;
      if (Array.isArray(field)) {
        return field.flatMap((f: any) => f.value || []);
      }
      return field.value;
    };

    const flags = attributes.flags || [];

    return {
      id: String(uid),
      uid,
      messageId: parsed.messageId || '',
      from: extractAddresses(parsed.from?.value),
      to: extractAddresses(getAddressValue(parsed.to)),
      cc: extractAddresses(getAddressValue(parsed.cc)),
      subject: parsed.subject || '(no subject)',
      date: parsed.date || new Date(),
      snippet: (parsed.text || '').substring(0, 200),
      body: parsed.text,
      htmlBody: parsed.html || undefined,
      attachments: (parsed.attachments || []).map((att): Attachment => ({
        filename: att.filename || 'unknown',
        contentType: att.contentType,
        size: att.size,
        contentId: att.contentId,
      })),
      labels: [],
      flags,
      threadId: parsed.references?.[0],
      size: attributes.size || 0,
      isRead: flags.includes('\\Seen'),
      isStarred: flags.includes('\\Flagged'),
    };
  }

  async moveEmail(uid: number, targetFolder: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.move([uid], targetFolder, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async deleteEmail(uid: number, trashFolder: string = '[Gmail]/Trash'): Promise<void> {
    await this.moveEmail(uid, trashFolder);
  }

  async addFlag(uid: number, flag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.addFlags([uid], [flag], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async removeFlag(uid: number, flag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.delFlags([uid], [flag], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async markAsRead(uid: number): Promise<void> {
    await this.addFlag(uid, '\\Seen');
  }

  async markAsUnread(uid: number): Promise<void> {
    await this.removeFlag(uid, '\\Seen');
  }

  async createFolder(folderName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.imap) {
        reject(new Error('Not connected'));
        return;
      }

      this.imap.addBox(folderName, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getEmailCount(mailbox: string = 'INBOX'): Promise<number> {
    const box = await this.openMailbox(mailbox);
    return box.messages.total;
  }
}

export const GMAIL_CONFIG: Partial<EmailConnectionConfig> = {
  provider: 'gmail',
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
  },
  folders: {
    inbox: 'INBOX',
    archive: '[Gmail]/All Mail',
    trash: '[Gmail]/Trash',
  },
};

export const OUTLOOK_CONFIG: Partial<EmailConnectionConfig> = {
  provider: 'outlook',
  imap: {
    host: 'outlook.office365.com',
    port: 993,
    tls: true,
  },
  folders: {
    inbox: 'INBOX',
    archive: 'Archive',
    trash: 'Deleted',
  },
};

export const YAHOO_CONFIG: Partial<EmailConnectionConfig> = {
  provider: 'imap',
  imap: {
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true,
  },
  folders: {
    inbox: 'INBOX',
    archive: 'Archive',
    trash: 'Trash',
  },
};
