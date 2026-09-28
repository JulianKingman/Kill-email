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
  ClassifierConfig,
} from '../types';

export const DEFAULT_SMART_KNOBS: SmartKnobs = {
  // Deletion sensitivity - be conservative by default
  deleteConfidenceThreshold: 0.85,

  // Escalation settings
  escalateOnAttachments: true,
  escalateOnRecent: true,
  recentThresholdDays: 7,

  // Categorization tuning
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

  // Batch processing
  smartBatchSize: 5,
  fastBatchSize: 20,

  // Human review triggers
  humanReviewPatterns: [
    'legal notice', 'court', 'subpoena', 'tax',
    'irs', 'government', 'urgent action required'
  ],
};

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  aggressiveness: 5, // Middle ground

  ageThresholds: {
    promotional: 30,    // Delete promos > 30 days
    newsletters: 90,    // Archive newsletters > 90 days
    receipts: 365,      // Keep receipts 1 year
    general: 180,       // General 6 months
  },

  trustedDomains: [],
  blockedDomains: [],

  maxEmailsPerRun: 500,
  dryRun: true,        // Safe by default
  requireConfirmation: true,
};

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'anthropic',
  apiKey: '',
  fastModel: 'claude-haiku-4-5',
  smartModel: 'claude-opus-5',
  escalationThreshold: 0.7,
  batchSize: 10,
  maxTokensPerEmail: 500,
};

// Model IDs that earlier versions saved to the config file, mapped to their replacements
export const RETIRED_MODELS: Record<string, string> = {
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-sonnet-4-20250514': 'claude-opus-5',
};

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  primary: 'claude',
  systemOne: {
    baseUrl: 'http://localhost:8000', // `laya-serve` default
    concurrency: 4,
    timeoutMs: 30000,
  },
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
    [EmailFate.ARCHIVE_RECEIPTS]: 2555,  // 7 years for tax purposes
    [EmailFate.ARCHIVE_PERSONAL]: 3650,   // 10 years
    [EmailFate.ARCHIVE_WORK]: 1825,       // 5 years
    [EmailFate.ARCHIVE_LEGAL]: 2555,      // 7 years
    [EmailFate.ARCHIVE_TRAVEL]: 365,      // 1 year
    [EmailFate.ARCHIVE_NEWSLETTERS]: 180, // 6 months
  },
};

export const DEFAULT_CONFIG: Partial<KillEmailConfig> = {
  llm: DEFAULT_LLM_CONFIG,
  processing: DEFAULT_PROCESSING_CONFIG,
  categories: DEFAULT_CATEGORY_CONFIG,
  ui: DEFAULT_UI_CONFIG,
  classifier: DEFAULT_CLASSIFIER_CONFIG,
};

// Preset configurations for different user types
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

// Smart knob descriptions for UI
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
