/**
 * WebSocket Handler
 */

import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { sessionManager } from '../services/session';
import {
  WSClientMessage,
  WSServerMessage,
  HumanDecisionPayload,
  EmailFate,
} from '@kill-email/shared';

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');
    let currentSessionId: string | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const message: WSClientMessage = JSON.parse(data.toString());
        handleMessage(ws, message, currentSessionId, (sessionId) => {
          currentSessionId = sessionId;
        });
      } catch (err) {
        sendError(ws, 'PARSE_ERROR', 'Invalid message format');
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      if (currentSessionId) {
        sessionManager.removeClient(currentSessionId, ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    // Send welcome message
    send(ws, {
      type: 'log',
      payload: {
        level: 'info',
        message: 'Connected to KILL EMAIL server',
      },
      timestamp: Date.now(),
    });
  });

  // Cleanup stale sessions periodically
  setInterval(() => {
    sessionManager.cleanupStale();
  }, 5 * 60 * 1000);

  return wss;
}

function handleMessage(
  ws: WebSocket,
  message: WSClientMessage,
  currentSessionId: string | null,
  setSessionId: (id: string) => void
): void {
  switch (message.type) {
    case 'subscribe': {
      const sessionId = message.payload as string;
      const session = sessionManager.getSession(sessionId);
      if (session) {
        sessionManager.addClient(sessionId, ws);
        setSessionId(sessionId);
        send(ws, {
          type: 'log',
          payload: {
            level: 'success',
            message: `Subscribed to session ${sessionId}`,
          },
          timestamp: Date.now(),
        });
      } else {
        sendError(ws, 'SESSION_NOT_FOUND', 'Session not found');
      }
      break;
    }

    case 'unsubscribe': {
      if (currentSessionId) {
        sessionManager.removeClient(currentSessionId, ws);
        setSessionId(null as any);
        send(ws, {
          type: 'log',
          payload: {
            level: 'info',
            message: 'Unsubscribed from session',
          },
          timestamp: Date.now(),
        });
      }
      break;
    }

    case 'human-decision': {
      const payload = message.payload as HumanDecisionPayload;
      if (currentSessionId) {
        const session = sessionManager.getSession(currentSessionId);
        const handler = session?.humanReviewHandlers?.get(payload.emailId);
        if (handler) {
          handler.resolve(payload.fate as EmailFate);
          session!.humanReviewHandlers.delete(payload.emailId);
          send(ws, {
            type: 'log',
            payload: {
              level: 'success',
              message: `Decision recorded for email ${payload.emailId}`,
            },
            timestamp: Date.now(),
          });
        }
      }
      break;
    }

    case 'cancel': {
      if (currentSessionId) {
        const session = sessionManager.getSession(currentSessionId);
        if (session) {
          session.status = 'paused';
          send(ws, {
            type: 'log',
            payload: {
              level: 'warning',
              message: 'Processing cancelled',
            },
            timestamp: Date.now(),
          });
        }
      }
      break;
    }

    default:
      sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${message.type}`);
  }
}

function send(ws: WebSocket, message: WSServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, {
    type: 'error',
    payload: { code, message, recoverable: true },
    timestamp: Date.now(),
  });
}
