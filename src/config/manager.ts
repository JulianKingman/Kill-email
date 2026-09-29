/**
 * KILL ALL EMAIL - Configuration Manager
 * "Your configuration files... give them to me"
 */

import Conf from 'conf';
import {
  KillEmailConfig,
  EmailConnectionConfig,
  SmartKnobs,
  ClassifierConfig,
} from '../types';
import {
  DEFAULT_CONFIG,
  DEFAULT_SMART_KNOBS,
  PRESETS,
  RETIRED_MODELS,
} from './defaults';

const CONFIG_SCHEMA = {
  email: {
    type: 'object',
    default: {},
  },
  llm: {
    type: 'object',
    default: DEFAULT_CONFIG.llm,
  },
  processing: {
    type: 'object',
    default: DEFAULT_CONFIG.processing,
  },
  categories: {
    type: 'object',
    default: DEFAULT_CONFIG.categories,
  },
  ui: {
    type: 'object',
    default: DEFAULT_CONFIG.ui,
  },
  knobs: {
    type: 'object',
    default: DEFAULT_SMART_KNOBS,
  },
  classifier: {
    type: 'object',
    default: DEFAULT_CONFIG.classifier,
  },
} as const;

// Settings read from the environment for this run only; secrets never get written to disk
function applyEnvOverrides(config: KillEmailConfig): KillEmailConfig {
  const env = process.env;
  const classifier: ClassifierConfig = {
    ...config.classifier,
    systemOne: { ...config.classifier.systemOne },
  };

  const primary = env.KILL_EMAIL_CLASSIFIER;
  if (primary === 'claude' || primary === 'system-one') classifier.primary = primary;
  if (env.SYSTEMONE_BASE_URL) classifier.systemOne.baseUrl = env.SYSTEMONE_BASE_URL;
  if (env.SYSTEMONE_API_KEY) classifier.systemOne.apiKey = env.SYSTEMONE_API_KEY;
  if (env.SYSTEMONE_MODEL) classifier.systemOne.model = env.SYSTEMONE_MODEL;

  return {
    ...config,
    llm: env.ANTHROPIC_API_KEY ? { ...config.llm, apiKey: env.ANTHROPIC_API_KEY } : config.llm,
    classifier,
  };
}

export class ConfigManager {
  private config: Conf<any>;

  constructor() {
    this.config = new Conf({
      projectName: 'kill-all-email',
      schema: CONFIG_SCHEMA as any,
    });
    this.migrateRetiredModels();
  }

  // Earlier versions saved model IDs that have since been retired
  private migrateRetiredModels(): void {
    const llm = this.config.get('llm');
    const fastModel = RETIRED_MODELS[llm.fastModel] ?? llm.fastModel;
    const smartModel = RETIRED_MODELS[llm.smartModel] ?? llm.smartModel;
    const { temperature: _unused, ...rest } = llm;
    if (fastModel !== llm.fastModel || smartModel !== llm.smartModel || 'temperature' in llm) {
      this.config.set('llm', { ...rest, fastModel, smartModel });
    }
  }

  // Get full configuration
  getConfig(): KillEmailConfig & { knobs: SmartKnobs } {
    return {
      ...applyEnvOverrides({
        email: this.config.get('email') as EmailConnectionConfig,
        llm: this.config.get('llm'),
        processing: this.config.get('processing'),
        categories: this.config.get('categories'),
        ui: this.config.get('ui'),
        classifier: this.config.get('classifier'),
      }),
      knobs: this.config.get('knobs'),
    };
  }

  // Get specific section
  get<K extends keyof KillEmailConfig>(key: K): KillEmailConfig[K] {
    return this.config.get(key);
  }

  // Get smart knobs
  getKnobs(): SmartKnobs {
    return this.config.get('knobs');
  }

  // Set specific value
  set<K extends keyof KillEmailConfig>(key: K, value: KillEmailConfig[K]): void {
    this.config.set(key, value);
  }

  // Set smart knobs
  setKnobs(knobs: Partial<SmartKnobs>): void {
    const current = this.getKnobs();
    this.config.set('knobs', { ...current, ...knobs });
  }

  // Set email connection
  setEmailConnection(emailConfig: EmailConnectionConfig): void {
    this.config.set('email', emailConfig);
  }

  // Set API key
  setApiKey(key: string): void {
    const llm = this.config.get('llm');
    this.config.set('llm', { ...llm, apiKey: key });
  }

  // Apply preset
  applyPreset(presetName: keyof typeof PRESETS): void {
    const preset = PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}`);
    }
    this.config.set('processing', preset.processing);
    this.config.set('knobs', preset.knobs);
  }

  // Check if configured
  isConfigured(): boolean {
    return this.getConfigStatus().ready;
  }

  // Get configuration status
  getConfigStatus(): {
    emailConfigured: boolean;
    llmConfigured: boolean;
    classifierConfigured: boolean;
    ready: boolean;
  } {
    const { email, llm, classifier } = this.getConfig();

    const emailConfigured = !!(
      email?.auth?.user &&
      (email?.auth?.password || email?.auth?.accessToken)
    );
    const llmConfigured = !!llm?.apiKey;
    // Claude needs an API key; a system-one server needs an address
    const classifierConfigured =
      classifier.primary === 'system-one' ? !!classifier.systemOne.baseUrl : llmConfigured;

    return {
      emailConfigured,
      llmConfigured,
      classifierConfigured,
      ready: emailConfigured && classifierConfigured,
    };
  }

  // Reset to defaults
  reset(): void {
    this.config.clear();
  }

  // Export configuration (without secrets)
  export(): Record<string, any> {
    const config = this.getConfig();
    // Remove sensitive data
    return {
      ...config,
      email: config.email ? {
        ...config.email,
        auth: { user: config.email.auth?.user },
      } : undefined,
      llm: {
        ...config.llm,
        apiKey: config.llm?.apiKey ? '***configured***' : undefined,
      },
      classifier: {
        ...config.classifier,
        systemOne: {
          ...config.classifier.systemOne,
          apiKey: config.classifier.systemOne.apiKey ? '***configured***' : undefined,
        },
      },
    };
  }

  // Get config file path
  getPath(): string {
    return this.config.path;
  }
}

// Singleton instance
let instance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!instance) {
    instance = new ConfigManager();
  }
  return instance;
}
