import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { ImapClient } from '../../src/email/imap-client';
import type { EmailConnectionConfig } from '@kill-email/shared';
import { GreenMailHarness } from './greenmail-harness';

const describeIfDocker = GreenMailHarness.isDockerAvailable() ? describe : describe.skip;

const config: EmailConnectionConfig = {
  provider: 'imap',
  imap: {
    host: GreenMailHarness.imapHost,
    port: GreenMailHarness.imapPort,
    tls: false,
  },
  auth: {
    user: GreenMailHarness.username,
    password: GreenMailHarness.password,
  },
  folders: {
    inbox: 'INBOX',
    archive: 'Archive',
    trash: 'Trash',
  },
};

describeIfDocker('ImapClient + GreenMail integration', () => {
  beforeAll(async () => {
    await GreenMailHarness.start();
  });

  afterAll(async () => {
    await GreenMailHarness.stop();
  });

  it('fetches emails that were seeded over SMTP', async () => {
    const subject = `integration-seed-${Date.now()}`;
    await GreenMailHarness.seedEmail({
      from: 'sender@example.com',
      to: GreenMailHarness.username,
      subject,
      body: 'This is a seeded email for IMAP integration testing.',
    });

    const client = new ImapClient(config);
    await client.connect();

    let emails = await client.fetchEmails({ mailbox: 'INBOX', all: true, limit: 100 });
    for (let attempt = 0; attempt < 8 && !emails.some((email) => email.subject === subject); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      emails = await client.fetchEmails({ mailbox: 'INBOX', all: true, limit: 100 });
    }

    const match = emails.find((email) => email.subject === subject);
    expect(match).toBeDefined();
    expect(match?.from[0]?.address).toContain('sender@example.com');
    expect(match?.snippet).toContain('seeded email');

    await client.disconnect();
  });

  it('moves seeded email to another folder', async () => {
    const subject = `integration-move-${Date.now()}`;
    await GreenMailHarness.seedEmail({
      from: 'sender@example.com',
      to: GreenMailHarness.username,
      subject,
      body: 'Move me to archive folder',
    });

    const client = new ImapClient(config);
    await client.connect();
    await client.createFolder('Archive').catch(() => undefined);

    let inboxEmails = await client.fetchEmails({ mailbox: 'INBOX', all: true, limit: 100 });
    for (let attempt = 0; attempt < 8 && !inboxEmails.some((email) => email.subject === subject); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      inboxEmails = await client.fetchEmails({ mailbox: 'INBOX', all: true, limit: 100 });
    }

    const seeded = inboxEmails.find((email) => email.subject === subject);
    expect(seeded).toBeDefined();

    await client.moveEmail(seeded!.uid, 'Archive');
    const archiveCount = await client.getEmailCount('Archive');
    expect(archiveCount).toBeGreaterThan(0);

    await client.disconnect();
  });
});
