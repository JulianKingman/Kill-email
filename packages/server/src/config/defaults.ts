/**
 * KILL ALL EMAIL - Default Configuration
 * "Hasta la vista, spam"
 */

import {
  KillEmailConfig,
  EmailFate,
  SmartKnobs,
  ProcessingConfig,
  LLMConfig,
  UIConfig,
  CategoryConfig,
} from '@kill-email/shared';

export const DEFAULT_SMART_KNOBS: SmartKnobs = {
  deleteConfidenceThreshold: 0.85,
  escalateOnAttachments: true,
  escalateOnRecent: true,
  recentThresholdDays: 7,
  receiptKeywords: [
    'receipt', 'invoice', 'order confirmation', 'payment',
    'purchase', 'transaction', 'billing', 'subscription'
  ],
  promotionalPatterns: [
    'unsubscribe', 'view in browser', 'email preferences',
    '% off', 'sale ends', 'limited time', 'act now',
    'free shipping', 'deal of the day'
  ],
  importantSenders: [],
  smartBatchSize: 5,
  fastBatchSize: 20,
  humanReviewPatterns: [
    'legal notice', 'court', 'subpoena', 'tax',
    'irs', 'government', 'urgent action required'
  ],
};

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  aggressiveness: 5,
  ageThresholds: {
    promotional: 30,
    newsletters: 90,
    receipts: 365,
    general: 180,
  },
  trustedDomains: [],
  blockedDomains: [],
  maxEmailsPerRun: 500,
  dryRun: true,
  requireConfirmation: true,
};

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'anthropic',
  apiKey: '',
  fastModel: 'claude-3-5-haiku-20241022',
  smartModel: 'claude-sonnet-4-20250514',
  escalationThreshold: 0.7,
  batchSize: 10,
  maxTokensPerEmail: 500,
  temperature: 0.3,
};

export const DEFAULT_UI_CONFIG: UIConfig = {
  theme: 'terminator',
  animations: true,
  scanlineEffect: true,
  glitchEffect: true,
  soundEffects: false,
  verboseLogging: false,
};

export const DEFAULT_CATEGORY_CONFIG: CategoryConfig = {
  enabled: {
    [EmailFate.TERMINATE]: true,
    [EmailFate.TERMINATE_DELAYED]: true,
    [EmailFate.ARCHIVE_RECEIPTS]: true,
    [EmailFate.ARCHIVE_PERSONAL]: true,
    [EmailFate.ARCHIVE_WORK]: true,
    [EmailFate.ARCHIVE_LEGAL]: true,
    [EmailFate.ARCHIVE_TRAVEL]: true,
    [EmailFate.ARCHIVE_NEWSLETTERS]: true,
    [EmailFate.KEEP_ACTION]: true,
    [EmailFate.KEEP_REFERENCE]: true,
    [EmailFate.KEEP_IMPORTANT]: true,
    [EmailFate.ESCALATE]: true,
    [EmailFate.HUMAN_REVIEW]: true,
  },
  customLabels: {
    [EmailFate.ARCHIVE_RECEIPTS]: 'Receipts',
    [EmailFate.ARCHIVE_PERSONAL]: 'Personal',
    [EmailFate.ARCHIVE_WORK]: 'Work',
    [EmailFate.ARCHIVE_LEGAL]: 'Legal & Financial',
    [EmailFate.ARCHIVE_TRAVEL]: 'Travel',
    [EmailFate.ARCHIVE_NEWSLETTERS]: 'Newsletters',
  },
  retentionDays: {
    [EmailFate.TERMINATE_DELAYED]: 7,
    [EmailFate.ARCHIVE_RECEIPTS]: 2555,
    [EmailFate.ARCHIVE_PERSONAL]: 3650,
    [EmailFate.ARCHIVE_WORK]: 1825,
    [EmailFate.ARCHIVE_LEGAL]: 2555,
    [EmailFate.ARCHIVE_TRAVEL]: 365,
    [EmailFate.ARCHIVE_NEWSLETTERS]: 180,
  },
};

export const DEFAULT_CONFIG: Partial<KillEmailConfig> = {
  llm: DEFAULT_LLM_CONFIG,
  processing: DEFAULT_PROCESSING_CONFIG,
  categories: DEFAULT_CATEGORY_CONFIG,
  ui: DEFAULT_UI_CONFIG,
};

export const PRESETS = {
  conservative: {
    name: 'Conservative',
    description: 'Very careful - only deletes obvious spam, keeps most emails',
    processing: {
      ...DEFAULT_PROCESSING_CONFIG,
      aggressiveness: 2,
      dryRun: true,
      requireConfirmation: true,
    },
    knobs: {
      ...DEFAULT_SMART_KNOBS,
      deleteConfidenceThreshold: 0.95,
      escalateOnAttachments: true,
      escalateOnRecent: true,
      recentThresholdDays: 14,
    },
  },
  balanced: {
    name: 'Balanced',
    description: 'Default settings - good balance of cleanup and safety',
    processing: DEFAULT_PROCESSING_CONFIG,
    knobs: DEFAULT_SMART_KNOBS,
  },
  aggressive: {
    name: 'Aggressive',
    description: 'Aggressively cleans inbox - faster but less careful',
    processing: {
      ...DEFAULT_PROCESSING_CONFIG,
      aggressiveness: 8,
      dryRun: false,
      ageThresholds: {
        promotional: 14,
        newsletters: 30,
        receipts: 365,
        general: 90,
      },
    },
    knobs: {
      ...DEFAULT_SMART_KNOBS,
      deleteConfidenceThreshold: 0.7,
      escalateOnAttachments: false,
      escalateOnRecent: false,
    },
  },
  terminator: {
    name: 'TERMINATOR',
    description: 'NO MERCY - Maximum deletion, minimal archiving',
    processing: {
      ...DEFAULT_PROCESSING_CONFIG,
      aggressiveness: 10,
      dryRun: false,
      requireConfirmation: false,
      ageThresholds: {
        promotional: 7,
        newsletters: 14,
        receipts: 180,
        general: 30,
      },
    },
    knobs: {
      ...DEFAULT_SMART_KNOBS,
      deleteConfidenceThreshold: 0.6,
      escalateOnAttachments: false,
      escalateOnRecent: false,
      recentThresholdDays: 3,
    },
  },
};

export const KNOB_DESCRIPTIONS = {
  aggressiveness: {
    name: 'Aggressiveness',
    description: 'How aggressive to be with deletions (1=conservative, 10=terminate everything)',
    min: 1,
    max: 10,
    default: 5,
  },
  deleteConfidenceThreshold: {
    name: 'Delete Confidence',
    description: 'Minimum confidence (0-1) required to auto-delete an email',
    min: 0,
    max: 1,
    default: 0.85,
  },
  escalationThreshold: {
    name: 'Escalation Threshold',
    description: 'Confidence below this triggers escalation to smarter model',
    min: 0,
    max: 1,
    default: 0.7,
  },
  recentThresholdDays: {
    name: 'Recent Email Days',
    description: 'Emails newer than this are treated more carefully',
    min: 1,
    max: 30,
    default: 7,
  },
};
