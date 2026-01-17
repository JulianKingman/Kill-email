import { create } from 'zustand';
import {
  ProcessingPhase,
  ProcessingStats,
  CategoryDecision,
  EmailMessage,
  ConfigResponse,
} from '@kill-email/shared';

export type View = 'menu' | 'config' | 'email' | 'processing' | 'review' | 'stats';
export type Theme = 'terminator' | 'matrix' | 'amber' | 'amber-light' | 'green';

interface TerminalLine {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'system' | 'ascii';
  timestamp: number;
}

interface ProcessedEmail {
  email: { id: string; subject: string; from: string; date: string };
  decision: CategoryDecision;
}

interface HumanReviewRequest {
  email: EmailMessage;
  decision: CategoryDecision;
  questions: string[];
}

interface AppState {
  // Connection
  connected: boolean;
  sessionId: string | null;

  // Config
  config: ConfigResponse | null;

  // Processing
  phase: ProcessingPhase;
  progress: { current: number; total: number };
  processedEmails: ProcessedEmail[];
  stats: ProcessingStats;

  // Human review
  reviewQueue: HumanReviewRequest[];
  currentReview: HumanReviewRequest | null;

  // Terminal
  terminalLines: TerminalLine[];

  // UI
  currentView: View;
  theme: Theme;
  crtEnabled: boolean;

  // Actions
  setConnected: (connected: boolean) => void;
  setSessionId: (sessionId: string | null) => void;
  setConfig: (config: ConfigResponse) => void;
  setPhase: (phase: ProcessingPhase) => void;
  setProgress: (current: number, total: number) => void;
  addProcessedEmail: (email: ProcessedEmail) => void;
  setStats: (stats: ProcessingStats) => void;
  addReviewRequest: (request: HumanReviewRequest) => void;
  setCurrentReview: (review: HumanReviewRequest | null) => void;
  addTerminalLine: (text: string, type: TerminalLine['type']) => void;
  clearTerminal: () => void;
  setView: (view: View) => void;
  setTheme: (theme: Theme) => void;
  setCrtEnabled: (enabled: boolean) => void;
  fetchConfig: () => Promise<void>;
  reset: () => void;
}

const initialStats: ProcessingStats = {
  totalEmails: 0,
  processed: 0,
  terminated: 0,
  archived: 0,
  kept: 0,
  escalated: 0,
  humanReview: 0,
  bytesFreed: 0,
  processingTimeMs: 0,
};

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  connected: false,
  sessionId: null,
  config: null,
  phase: ProcessingPhase.INITIALIZING,
  progress: { current: 0, total: 0 },
  processedEmails: [],
  stats: initialStats,
  reviewQueue: [],
  currentReview: null,
  terminalLines: [],
  currentView: 'menu',
  theme: 'terminator',
  crtEnabled: true,

  // Actions
  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  setConfig: (config) => set({ config, theme: config.ui.theme as Theme }),
  setPhase: (phase) => set({ phase }),
  setProgress: (current, total) => set({ progress: { current, total } }),
  addProcessedEmail: (email) =>
    set((state) => ({ processedEmails: [...state.processedEmails, email] })),
  setStats: (stats) => set({ stats }),
  addReviewRequest: (request) =>
    set((state) => ({
      reviewQueue: [...state.reviewQueue, request],
      currentReview: state.currentReview || request,
    })),
  setCurrentReview: (review) => set({ currentReview: review }),
  addTerminalLine: (text, type) =>
    set((state) => ({
      terminalLines: [
        ...state.terminalLines,
        { id: crypto.randomUUID(), text, type, timestamp: Date.now() },
      ].slice(-500), // Keep last 500 lines
    })),
  clearTerminal: () => set({ terminalLines: [] }),
  setView: (view) => set({ currentView: view }),
  setTheme: (theme) => set({ theme }),
  setCrtEnabled: (enabled) => set({ crtEnabled: enabled }),

  fetchConfig: async () => {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      set({ config, theme: config.ui?.theme || 'terminator' });
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  },

  reset: () =>
    set({
      sessionId: null,
      phase: ProcessingPhase.INITIALIZING,
      progress: { current: 0, total: 0 },
      processedEmails: [],
      stats: initialStats,
      reviewQueue: [],
      currentReview: null,
    }),
}));
