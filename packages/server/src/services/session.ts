/**
 * Session Manager - Manages processing sessions
 */

import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';
import {
  KillEmailConfig,
  SmartKnobs,
  ProcessingStats,
  ProcessingPhase,
  WSServerMessage,
  EmailFate,
} from '@kill-email/shared';

export interface ProcessingSession {
  id: string;
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error';
  startTime: Date;
  config: Partial<KillEmailConfig>;
  knobs: SmartKnobs;
  stats: ProcessingStats;
  phase: ProcessingPhase;
  wsClients: Set<WebSocket>;
  humanReviewHandlers: Map<string, {
    resolve: (fate: EmailFate) => void;
    reject: (error: Error) => void;
  }>;
}

class SessionManager {
  private sessions: Map<string, ProcessingSession> = new Map();
  private static instance: SessionManager;

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  createSession(config: Partial<KillEmailConfig>, knobs: SmartKnobs): string {
    const id = nanoid();
    const session: ProcessingSession = {
      id,
      status: 'idle',
      startTime: new Date(),
      config,
      knobs,
      stats: {
        totalEmails: 0,
        processed: 0,
        terminated: 0,
        archived: 0,
        kept: 0,
        escalated: 0,
        humanReview: 0,
        bytesFreed: 0,
        processingTimeMs: 0,
      },
      phase: ProcessingPhase.INITIALIZING,
      wsClients: new Set(),
      humanReviewHandlers: new Map(),
    };

    this.sessions.set(id, session);
    return id;
  }

  getSession(id: string): ProcessingSession | undefined {
    return this.sessions.get(id);
  }

  updateSession(id: string, updates: Partial<ProcessingSession>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates);
    }
  }

  addClient(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.wsClients.add(ws);
    }
  }

  removeClient(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.wsClients.delete(ws);
    }
  }

  broadcast(sessionId: string, event: WSServerMessage): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const message = JSON.stringify(event);
      session.wsClients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  broadcastToAll(event: WSServerMessage): void {
    const message = JSON.stringify(event);
    this.sessions.forEach((session) => {
      session.wsClients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    });
  }

  deleteSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.wsClients.forEach((ws) => ws.close());
      this.sessions.delete(id);
    }
  }

  cleanupStale(maxAgeMs: number = 60 * 60 * 1000): void {
    const now = Date.now();
    this.sessions.forEach((session, id) => {
      if (
        session.status === 'complete' ||
        session.status === 'error'
      ) {
        const age = now - session.startTime.getTime();
        if (age > maxAgeMs) {
          this.deleteSession(id);
        }
      }
    });
  }

  getActiveSessions(): ProcessingSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'running'
    );
  }
}

export const sessionManager = SessionManager.getInstance();
