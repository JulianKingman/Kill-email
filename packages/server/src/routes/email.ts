/**
 * Email Setup Routes
 */

import { Router } from 'express';
import { configManager } from '../config/manager';
import { ImapClient, GMAIL_CONFIG, OUTLOOK_CONFIG, YAHOO_CONFIG } from '../email/imap-client';
import { EmailConnectionConfig, EmailSetupRequest } from '@kill-email/shared';

export const emailRouter = Router();

// POST /api/email/setup - Setup email connection
emailRouter.post('/setup', async (req, res): Promise<void> => {
  const { provider, email, password, host, port, tls } = req.body as EmailSetupRequest;

  let config: EmailConnectionConfig;

  switch (provider) {
    case 'gmail':
      config = {
        ...GMAIL_CONFIG,
        auth: { user: email, password },
      } as EmailConnectionConfig;
      break;

    case 'outlook':
      config = {
        ...OUTLOOK_CONFIG,
        auth: { user: email, password },
      } as EmailConnectionConfig;
      break;

    case 'yahoo':
      config = {
        ...YAHOO_CONFIG,
        auth: { user: email, password },
      } as EmailConnectionConfig;
      break;

    case 'custom':
      if (!host || !port) {
        res.status(400).json({ error: 'Custom IMAP requires host and port' });
        return;
      }
      config = {
        provider: 'imap',
        imap: { host, port, tls: tls !== false },
        auth: { user: email, password },
        folders: { inbox: 'INBOX', archive: 'Archive', trash: 'Trash' },
      };
      break;

    default:
      res.status(400).json({ error: 'Invalid provider' });
      return;
  }

  configManager.setEmailConfig(config);
  res.json({ success: true });
});

// POST /api/email/test - Test email connection
emailRouter.post('/test', async (req, res): Promise<void> => {
  const config = configManager.getConfig();

  if (!config.email) {
    res.status(400).json({ success: false, error: 'Email not configured' });
    return;
  }

  const client = new ImapClient(config.email);

  try {
    await client.connect();
    const count = await client.getEmailCount();
    await client.disconnect();

    res.json({ success: true, emailCount: count });
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    });
  }
});

// DELETE /api/email - Clear email configuration
emailRouter.delete('/', (req, res) => {
  configManager.clearEmailConfig();
  res.json({ success: true });
});
