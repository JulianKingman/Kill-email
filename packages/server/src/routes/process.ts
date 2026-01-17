/**
 * Processing Routes
 */

import { Router } from 'express';
import { configManager } from '../config/manager';
import { sessionManager } from '../services/session';
import { ImapClient } from '../email/imap-client';
import { EmailOrganizer } from '../email/organizer';
import { EmailCategorizer } from '../llm/categorizer';
import { DEFAULT_CATEGORY_CONFIG } from '../config/defaults';
import {
  ProcessingPhase,
  ProcessStartRequest,
  ProcessStartResponse,
  EmailMessage,
  EmailFate,
  WSServerMessage,
} from '@kill-email/shared';

export const processRouter = Router();

// POST /api/process/start - Start processing
processRouter.post('/start', async (req, res): Promise<void> => {
  const { folder = 'INBOX', limit = 100, dryRun = true } = req.body as ProcessStartRequest;

  const config = configManager.getConfig();
  const knobs = configManager.getKnobs();

  if (!configManager.isReady()) {
    res.status(400).json({ error: 'Email and LLM must be configured first' });
    return;
  }

  const sessionId = sessionManager.createSession(config, knobs);
  const session = sessionManager.getSession(sessionId)!;

  const response: ProcessStartResponse = { sessionId, status: 'started' };
  res.json(response);

  // Run processing in background
  runProcessing(sessionId, folder, limit, dryRun).catch((err) => {
    console.error('Processing error:', err);
    session.status = 'error';
    broadcast(sessionId, {
      type: 'error',
      payload: {
        code: 'PROCESSING_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
        recoverable: false,
      },
      timestamp: Date.now(),
    });
  });
});

// POST /api/process/stop - Stop processing
processRouter.post('/stop', (req, res): void => {
  const { sessionId } = req.body;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.status = 'paused';
  res.json({ success: true });
});

// GET /api/process/status - Get processing status
processRouter.get('/status/:sessionId', (req, res): void => {
  const session = sessionManager.getSession(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    sessionId: session.id,
    status: session.status,
    phase: session.phase,
    stats: session.stats,
  });
});

// POST /api/llm/setup - Setup LLM API key
processRouter.post('/llm/setup', (req, res): void => {
  const { apiKey } = req.body;

  if (!apiKey) {
    res.status(400).json({ error: 'API key required' });
    return;
  }

  configManager.setLLMConfig({ apiKey });
  res.json({ success: true });
});

function broadcast(sessionId: string, event: WSServerMessage): void {
  sessionManager.broadcast(sessionId, event);
}

async function runProcessing(
  sessionId: string,
  folder: string,
  limit: number,
  dryRun: boolean
): Promise<void> {
  const session = sessionManager.getSession(sessionId)!;
  session.status = 'running';

  const config = configManager.getConfig();
  const knobs = configManager.getKnobs();

  // Phase: Connecting
  session.phase = ProcessingPhase.CONNECTING;
  broadcast(sessionId, {
    type: 'phase-change',
    payload: { phase: ProcessingPhase.CONNECTING, message: 'Connecting to mail server...' },
    timestamp: Date.now(),
  });

  const client = new ImapClient(config.email!);
  await client.connect();

  broadcast(sessionId, {
    type: 'log',
    payload: { level: 'success', message: 'Connection established' },
    timestamp: Date.now(),
  });

  // Phase: Scanning
  session.phase = ProcessingPhase.SCANNING;
  broadcast(sessionId, {
    type: 'phase-change',
    payload: { phase: ProcessingPhase.SCANNING, message: `Scanning ${folder}...` },
    timestamp: Date.now(),
  });

  client.on('progress', (current: number, total: number) => {
    broadcast(sessionId, {
      type: 'progress',
      payload: { current, total, phase: ProcessingPhase.SCANNING, message: `Fetching emails...` },
      timestamp: Date.now(),
    });
  });

  const emails = await client.fetchEmails({ mailbox: folder, limit, all: true });
  session.stats.totalEmails = emails.length;

  broadcast(sessionId, {
    type: 'log',
    payload: { level: 'success', message: `Found ${emails.length} emails` },
    timestamp: Date.now(),
  });

  if (emails.length === 0) {
    session.status = 'complete';
    session.phase = ProcessingPhase.COMPLETE;
    broadcast(sessionId, {
      type: 'complete',
      payload: { stats: session.stats },
      timestamp: Date.now(),
    });
    await client.disconnect();
    return;
  }

  // Phase: Categorizing
  session.phase = ProcessingPhase.CATEGORIZING;
  broadcast(sessionId, {
    type: 'phase-change',
    payload: { phase: ProcessingPhase.CATEGORIZING, message: 'Categorizing emails...' },
    timestamp: Date.now(),
  });

  const categorizer = new EmailCategorizer(config.llm!, knobs, config.processing!);

  // Pre-filter with rules
  const { obvious, needsLLM } = categorizer.preFilterEmails(emails);

  broadcast(sessionId, {
    type: 'log',
    payload: { level: 'info', message: `${obvious.length} emails categorized by rules, ${needsLLM.length} need AI analysis` },
    timestamp: Date.now(),
  });

  // Categorize with LLM
  const result = await categorizer.categorizeBatch(needsLLM, false);
  const allDecisions = [...obvious, ...result.decisions];

  // Broadcast each decision
  for (const decision of allDecisions) {
    const email = emails.find(e => e.id === decision.emailId);
    if (email) {
      broadcast(sessionId, {
        type: 'email-processed',
        payload: {
          email: {
            id: email.id,
            subject: email.subject,
            from: email.from[0]?.address || 'unknown',
            date: email.date.toISOString(),
          },
          decision,
        },
        timestamp: Date.now(),
      });
    }
  }

  // Phase: Escalating (if needed)
  if (result.escalated.length > 0) {
    session.phase = ProcessingPhase.ESCALATING;
    broadcast(sessionId, {
      type: 'phase-change',
      payload: { phase: ProcessingPhase.ESCALATING, message: `Analyzing ${result.escalated.length} complex emails...` },
      timestamp: Date.now(),
    });

    const escalatedResult = await categorizer.categorizeBatch(result.escalated, true);
    allDecisions.push(...escalatedResult.decisions);

    session.stats.escalated = result.escalated.length;
  }

  // Handle human review emails
  const humanReviewDecisions = allDecisions.filter(d => d.fate === EmailFate.HUMAN_REVIEW);
  session.stats.humanReview = humanReviewDecisions.length;

  if (humanReviewDecisions.length > 0 && !dryRun) {
    session.phase = ProcessingPhase.REVIEWING;
    broadcast(sessionId, {
      type: 'phase-change',
      payload: { phase: ProcessingPhase.REVIEWING, message: `${humanReviewDecisions.length} emails need your review` },
      timestamp: Date.now(),
    });

    for (const decision of humanReviewDecisions) {
      const email = emails.find(e => e.id === decision.emailId);
      if (email) {
        broadcast(sessionId, {
          type: 'human-review',
          payload: { email, decision, questions: [] },
          timestamp: Date.now(),
        });

        // Wait for human decision with timeout
        try {
          const fate = await waitForHumanDecision(sessionId, email.id, 5 * 60 * 1000);
          decision.fate = fate;
          decision.modelUsed = 'human';
        } catch {
          // Timeout - keep as HUMAN_REVIEW (skip action)
        }
      }
    }
  }

  // Phase: Executing
  session.phase = ProcessingPhase.EXECUTING;
  broadcast(sessionId, {
    type: 'phase-change',
    payload: { phase: ProcessingPhase.EXECUTING, message: dryRun ? 'Previewing actions...' : 'Executing actions...' },
    timestamp: Date.now(),
  });

  const organizer = new EmailOrganizer(client, DEFAULT_CATEGORY_CONFIG, config.email!.folders);
  const actions = organizer.decisionsToActions(
    allDecisions.filter(d => d.fate !== EmailFate.HUMAN_REVIEW && d.fate !== EmailFate.ESCALATE)
  );

  const emailMap = new Map<string, EmailMessage>();
  emails.forEach(e => emailMap.set(e.id, e));

  if (dryRun) {
    const preview = organizer.previewActions(actions, emailMap);
    broadcast(sessionId, {
      type: 'log',
      payload: {
        level: 'info',
        message: `DRY RUN: Would delete ${preview.toDelete.length}, archive ${preview.toArchive.length}, label ${preview.toKeep.length}`,
      },
      timestamp: Date.now(),
    });
  } else {
    const confirmedActions = organizer.confirmAllActions(actions);
    const execResult = await organizer.executeActions(confirmedActions, emailMap, (current, total) => {
      broadcast(sessionId, {
        type: 'progress',
        payload: { current, total, phase: ProcessingPhase.EXECUTING, message: 'Executing...' },
        timestamp: Date.now(),
      });
    });

    session.stats = { ...session.stats, ...execResult.stats };
  }

  // Complete
  session.status = 'complete';
  session.phase = ProcessingPhase.COMPLETE;
  broadcast(sessionId, {
    type: 'complete',
    payload: { stats: session.stats },
    timestamp: Date.now(),
  });

  await client.disconnect();
}

function waitForHumanDecision(sessionId: string, emailId: string, timeout: number): Promise<EmailFate> {
  return new Promise((resolve, reject) => {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      reject(new Error('Session not found'));
      return;
    }

    session.humanReviewHandlers.set(emailId, { resolve, reject });

    setTimeout(() => {
      if (session.humanReviewHandlers.has(emailId)) {
        session.humanReviewHandlers.delete(emailId);
        reject(new Error('Timeout'));
      }
    }, timeout);
  });
}
