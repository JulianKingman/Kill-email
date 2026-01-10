/**
 * KILL ALL EMAIL - Configuration Manager
 * "Your configuration files... give them to me"
 */

import Conf from 'conf';
import {
  KillEmailConfig,
  EmailConnectionConfig,
  SmartKnobs,
} from '../types';
import {
  DEFAULT_CONFIG,
  DEFAULT_SMART_KNOBS,
  PRESETS,
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
} as const;

export class ConfigManager {
  private config: Conf<any>;

  constructor() {
    this.config = new Conf({
      projectName: 'kill-all-email',
      schema: CONFIG_SCHEMA as any,
    });
  }

  // Get full configuration
  getConfig(): KillEmailConfig & { knobs: SmartKnobs } {
    return {
      email: this.config.get('email') as EmailConnectionConfig,
      llm: this.config.get('llm'),
      processing: this.config.get('processing'),
      categories: this.config.get('categories'),
      ui: this.config.get('ui'),
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
    const email = this.config.get('email') as EmailConnectionConfig | undefined;
    const llm = this.config.get('llm');

    return !!(
      email?.auth?.user &&
      (email?.auth?.password || email?.auth?.accessToken) &&
      llm?.apiKey
    );
  }

  // Get configuration status
  getConfigStatus(): {
    emailConfigured: boolean;
    llmConfigured: boolean;
    ready: boolean;
  } {
    const email = this.config.get('email') as EmailConnectionConfig | undefined;
    const llm = this.config.get('llm');

    const emailConfigured = !!(
      email?.auth?.user &&
      (email?.auth?.password || email?.auth?.accessToken)
    );
    const llmConfigured = !!llm?.apiKey;

    return {
      emailConfigured,
      llmConfigured,
      ready: emailConfigured && llmConfigured,
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
