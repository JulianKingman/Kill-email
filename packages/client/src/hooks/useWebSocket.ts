import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  WSServerMessage,
  PhaseChangePayload,
  ProgressPayload,
  EmailProcessedPayload,
  LogPayload,
  CompletePayload,
  HumanReviewPayload,
  ProcessingPhase,
} from '@kill-email/shared';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();

  const {
    sessionId,
    setConnected,
    setPhase,
    setProgress,
    addProcessedEmail,
    setStats,
    addTerminalLine,
    addReviewRequest,
  } = useAppStore();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);

      // Subscribe to session if we have one
      if (sessionId) {
        ws.send(JSON.stringify({ type: 'subscribe', payload: sessionId }));
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);

      // Reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const message: WSServerMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    wsRef.current = ws;
  }, [sessionId, setConnected]);

  const handleMessage = useCallback((message: WSServerMessage) => {
    switch (message.type) {
      case 'phase-change': {
        const payload = message.payload as PhaseChangePayload;
        setPhase(payload.phase);
        addTerminalLine(payload.message, 'system');
        break;
      }

      case 'progress': {
        const payload = message.payload as ProgressPayload;
        setProgress(payload.current, payload.total);
        break;
      }

      case 'email-processed': {
        const payload = message.payload as EmailProcessedPayload;
        addProcessedEmail(payload);
        break;
      }

      case 'log': {
        const payload = message.payload as LogPayload;
        addTerminalLine(payload.message, payload.level);
        break;
      }

      case 'complete': {
        const payload = message.payload as CompletePayload;
        setStats(payload.stats);
        setPhase(ProcessingPhase.COMPLETE);
        addTerminalLine('MISSION COMPLETE', 'success');
        break;
      }

      case 'human-review': {
        const payload = message.payload as HumanReviewPayload;
        addReviewRequest(payload);
        addTerminalLine(`Human review required: ${payload.email.subject}`, 'warning');
        break;
      }

      case 'error': {
        const payload = message.payload as { message: string };
        addTerminalLine(`ERROR: ${payload.message}`, 'error');
        break;
      }

      case 'stats-update': {
        const payload = message.payload as { stats: any };
        setStats(payload.stats);
        break;
      }
    }
  }, [setPhase, setProgress, addProcessedEmail, setStats, addTerminalLine, addReviewRequest]);

  // Subscribe to session when it changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', payload: sessionId }));
    }
  }, [sessionId]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Send human decision
  const sendHumanDecision = useCallback((emailId: string, fate: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'human-decision',
        payload: { emailId, fate },
      }));
    }
  }, []);

  return { sendHumanDecision };
}
