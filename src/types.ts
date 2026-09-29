/**
 * KILL ALL EMAIL - Type Definitions
 * "I'll be back... to clean your inbox"
 */

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

// Organization categories - the fate of each email
export enum EmailFate {
  // Termination targets
  TERMINATE = 'TERMINATE',           // Delete immediately
  TERMINATE_DELAYED = 'TERMINATE_DELAYED', // Delete after X days

  // Archive categories
  ARCHIVE_RECEIPTS = 'ARCHIVE_RECEIPTS',
  ARCHIVE_PERSONAL = 'ARCHIVE_PERSONAL',
  ARCHIVE_WORK = 'ARCHIVE_WORK',
  ARCHIVE_LEGAL = 'ARCHIVE_LEGAL',
  ARCHIVE_TRAVEL = 'ARCHIVE_TRAVEL',
  ARCHIVE_NEWSLETTERS = 'ARCHIVE_NEWSLETTERS',

  // Keep in inbox
  KEEP_ACTION = 'KEEP_ACTION',       // Needs response/action
  KEEP_REFERENCE = 'KEEP_REFERENCE', // Reference material
  KEEP_IMPORTANT = 'KEEP_IMPORTANT', // Important - don't touch

  // Escalation
  ESCALATE = 'ESCALATE',             // Needs smarter model
  HUMAN_REVIEW = 'HUMAN_REVIEW',     // Needs human decision
}

export interface CategoryDecision {
  emailId: string;
  fate: EmailFate;
  confidence: number;        // 0-1, how confident the model is
  reasoning: string;         // Why this decision was made
  modelUsed: string;         // Which rule or classifier made the call (e.g. 'rules', 'system-one', a Claude model, 'human')
  suggestedLabel?: string;
  escalatedFrom?: EmailFate; // If this was escalated
  timestamp: Date;
}

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

// Configuration types
export interface KillEmailConfig {
  email: EmailConnectionConfig;
  llm: LLMConfig;
  processing: ProcessingConfig;
  categories: CategoryConfig;
  ui: UIConfig;
  classifier: ClassifierConfig;
}

// Which model does the first-pass categorization. Claude always handles escalations.
export interface ClassifierConfig {
  primary: 'claude' | 'system-one';
  systemOne: SystemOneConfig;
}

// Any server speaking the /v1/systemone decision API: TypeSafe's hosted Jev, or a local `laya-serve`
export interface SystemOneConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  concurrency: number;
  timeoutMs: number;
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
    password?: string;        // App password for Gmail
    accessToken?: string;     // OAuth token
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
  fastModel: string;         // Quick categorization
  smartModel: string;        // Complex decisions
  escalationThreshold: number; // Confidence below this → escalate
  batchSize: number;         // Emails per API call
  maxTokensPerEmail: number;
}

export interface ProcessingConfig {
  // Aggressiveness: 1 = very conservative, 10 = terminate everything old
  aggressiveness: number;

  // Age thresholds (days)
  ageThresholds: {
    promotional: number;     // Delete promos older than X days
    newsletters: number;     // Archive newsletters older than X
    receipts: number;        // Keep receipts for X days minimum
    general: number;         // General age for stale content
  };

  // Sender trust levels
  trustedDomains: string[];  // Always keep
  blockedDomains: string[];  // Always terminate

  // Processing limits
  maxEmailsPerRun: number;
  dryRun: boolean;           // Preview without executing
  requireConfirmation: boolean; // Ask before bulk actions
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

// Smart knobs - adjustable parameters
export interface SmartKnobs {
  // Deletion sensitivity
  deleteConfidenceThreshold: number;  // 0-1, minimum confidence to auto-delete

  // Escalation settings
  escalateOnAttachments: boolean;     // Escalate if email has attachments
  escalateOnRecent: boolean;          // Escalate if email < X days old
  recentThresholdDays: number;

  // Categorization tuning
  receiptKeywords: string[];
  promotionalPatterns: string[];
  importantSenders: string[];

  // Batch processing
  smartBatchSize: number;             // Emails to send to smart model at once
  fastBatchSize: number;              // Emails to send to fast model at once

  // Human review triggers
  humanReviewPatterns: string[];      // Always ask human for these
}

// Session state
export interface SessionState {
  startTime: Date;
  emailsScanned: number;
  decisions: CategoryDecision[];
  pendingActions: PendingAction[];
  stats: ProcessingStats;
  currentPhase: ProcessingPhase;
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

export interface PendingAction {
  emailId: string;
  action: 'delete' | 'archive' | 'label' | 'move';
  targetFolder?: string;
  label?: string;
  confirmed: boolean;
}

// Event types for UI updates
export interface ProcessingEvent {
  type: 'email_processed' | 'batch_complete' | 'escalation' | 'error' | 'stats_update';
  data: any;
  timestamp: Date;
}
