/**
 * KILL ALL EMAIL - Shared Type Definitions
 * "I'll be back... to clean your inbox"
 */

// ============================================
// Email Types
// ============================================

export interface EmailMessage {
  id: string;
  uid: number;
  messageId: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  date: Date;
  snippet: string;
  body?: string;
  htmlBody?: string;
  attachments: Attachment[];
  labels: string[];
  flags: string[];
  threadId?: string;
  size: number;
  isRead: boolean;
  isStarred: boolean;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

// ============================================
// Email Fate & Decisions
// ============================================

export enum EmailFate {
  // Termination targets
  TERMINATE = 'TERMINATE',
  TERMINATE_DELAYED = 'TERMINATE_DELAYED',

  // Archive categories
  ARCHIVE_RECEIPTS = 'ARCHIVE_RECEIPTS',
  ARCHIVE_PERSONAL = 'ARCHIVE_PERSONAL',
  ARCHIVE_WORK = 'ARCHIVE_WORK',
  ARCHIVE_LEGAL = 'ARCHIVE_LEGAL',
  ARCHIVE_TRAVEL = 'ARCHIVE_TRAVEL',
  ARCHIVE_NEWSLETTERS = 'ARCHIVE_NEWSLETTERS',

  // Keep in inbox
  KEEP_ACTION = 'KEEP_ACTION',
  KEEP_REFERENCE = 'KEEP_REFERENCE',
  KEEP_IMPORTANT = 'KEEP_IMPORTANT',

  // Escalation
  ESCALATE = 'ESCALATE',
  HUMAN_REVIEW = 'HUMAN_REVIEW',
}

export interface CategoryDecision {
  emailId: string;
  fate: EmailFate;
  confidence: number;
  reasoning: string;
  modelUsed: 'fast' | 'smart' | 'human';
  suggestedLabel?: string;
  escalatedFrom?: EmailFate;
  timestamp: Date;
}

// ============================================
// Processing Stats & State
// ============================================

export interface ProcessingStats {
  totalEmails: number;
  processed: number;
  terminated: number;
  archived: number;
  kept: number;
  escalated: number;
  humanReview: number;
  bytesFreed: number;
  processingTimeMs: number;
}

export enum ProcessingPhase {
  INITIALIZING = 'INITIALIZING',
  CONNECTING = 'CONNECTING',
  SCANNING = 'SCANNING',
  CATEGORIZING = 'CATEGORIZING',
  ESCALATING = 'ESCALATING',
  REVIEWING = 'REVIEWING',
  EXECUTING = 'EXECUTING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

export interface SessionState {
  startTime: Date;
  emailsScanned: number;
  decisions: CategoryDecision[];
  pendingActions: PendingAction[];
  stats: ProcessingStats;
  currentPhase: ProcessingPhase;
}

export interface PendingAction {
  emailId: string;
  action: 'delete' | 'archive' | 'label' | 'move';
  targetFolder?: string;
  label?: string;
  confirmed: boolean;
}

// ============================================
// Configuration Types
// ============================================

export interface KillEmailConfig {
  email: EmailConnectionConfig;
  llm: LLMConfig;
  processing: ProcessingConfig;
  categories: CategoryConfig;
  ui: UIConfig;
}

export interface EmailConnectionConfig {
  provider: 'gmail' | 'imap' | 'outlook';
  imap: {
    host: string;
    port: number;
    tls: boolean;
  };
  auth: {
    user: string;
    password?: string;
    accessToken?: string;
    refreshToken?: string;
  };
  folders: {
    inbox: string;
    archive: string;
    trash: string;
  };
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  fastModel: string;
  smartModel: string;
  escalationThreshold: number;
  batchSize: number;
  maxTokensPerEmail: number;
  temperature: number;
}

export interface ProcessingConfig {
  aggressiveness: number;
  ageThresholds: {
    promotional: number;
    newsletters: number;
    receipts: number;
    general: number;
  };
  trustedDomains: string[];
  blockedDomains: string[];
  maxEmailsPerRun: number;
  dryRun: boolean;
  requireConfirmation: boolean;
}

export interface CategoryConfig {
  enabled: { [key in EmailFate]?: boolean };
  customLabels: { [key in EmailFate]?: string };
  retentionDays: { [key in EmailFate]?: number };
}

export interface UIConfig {
  theme: 'terminator' | 'matrix' | 'amber' | 'green';
  animations: boolean;
  scanlineEffect: boolean;
  glitchEffect: boolean;
  soundEffects: boolean;
  verboseLogging: boolean;
}

export interface SmartKnobs {
  deleteConfidenceThreshold: number;
  escalateOnAttachments: boolean;
  escalateOnRecent: boolean;
  recentThresholdDays: number;
  receiptKeywords: string[];
  promotionalPatterns: string[];
  importantSenders: string[];
  smartBatchSize: number;
  fastBatchSize: number;
  humanReviewPatterns: string[];
}

// ============================================
// WebSocket Message Types
// ============================================

export type WSServerMessageType =
  | 'phase-change'
  | 'progress'
  | 'email-processed'
  | 'batch-complete'
  | 'human-review'
  | 'stats-update'
  | 'error'
  | 'complete'
  | 'log';

export interface WSServerMessage {
  type: WSServerMessageType;
  payload: unknown;
  timestamp: number;
}

export interface PhaseChangePayload {
  phase: ProcessingPhase;
  message: string;
}

export interface ProgressPayload {
  current: number;
  total: number;
  phase: ProcessingPhase;
  message: string;
}

export interface EmailProcessedPayload {
  email: {
    id: string;
    subject: string;
    from: string;
    date: string;
  };
  decision: CategoryDecision;
}

export interface HumanReviewPayload {
  email: EmailMessage;
  decision: CategoryDecision;
  questions: string[];
}

export interface LogPayload {
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface CompletePayload {
  stats: ProcessingStats;
}

export type WSClientMessageType = 'subscribe' | 'unsubscribe' | 'human-decision' | 'cancel';

export interface WSClientMessage {
  type: WSClientMessageType;
  payload: unknown;
}

export interface HumanDecisionPayload {
  emailId: string;
  fate: EmailFate;
}

// ============================================
// API Types
// ============================================

export interface ConfigResponse {
  email: { provider: string; user?: string } | null;
  processing: ProcessingConfig;
  ui: UIConfig;
  knobs: SmartKnobs;
  status: {
    emailConfigured: boolean;
    llmConfigured: boolean;
    ready: boolean;
  };
}

export interface EmailSetupRequest {
  provider: 'gmail' | 'outlook' | 'yahoo' | 'custom';
  email: string;
  password: string;
  host?: string;
  port?: number;
  tls?: boolean;
}

export interface ProcessStartRequest {
  folder?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface ProcessStartResponse {
  sessionId: string;
  status: 'started';
}
