/**
 * Configuration Manager - Persistent config storage
 */

import Conf from 'conf';
import {
  KillEmailConfig,
  SmartKnobs,
  EmailConnectionConfig,
  LLMConfig,
  ProcessingConfig,
  UIConfig,
} from '@kill-email/shared';
import {
  DEFAULT_SMART_KNOBS,
  DEFAULT_PROCESSING_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_UI_CONFIG,
  DEFAULT_CATEGORY_CONFIG,
  PRESETS,
} from './defaults';

interface StoredConfig {
  email?: EmailConnectionConfig;
  llm: LLMConfig;
  processing: ProcessingConfig;
  ui: UIConfig;
  knobs: SmartKnobs;
}

class ConfigManager {
  private store: Conf<StoredConfig>;
  private static instance: ConfigManager;

  private constructor() {
    this.store = new Conf<StoredConfig>({
      projectName: 'kill-email',
      defaults: {
        llm: DEFAULT_LLM_CONFIG,
        processing: DEFAULT_PROCESSING_CONFIG,
        ui: DEFAULT_UI_CONFIG,
        knobs: DEFAULT_SMART_KNOBS,
      },
    });
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getConfig(): Partial<KillEmailConfig> {
    return {
      email: this.store.get('email'),
      llm: this.store.get('llm'),
      processing: this.store.get('processing'),
      categories: DEFAULT_CATEGORY_CONFIG,
      ui: this.store.get('ui'),
    };
  }

  getKnobs(): SmartKnobs {
    return this.store.get('knobs');
  }

  setEmailConfig(config: EmailConnectionConfig): void {
    this.store.set('email', config);
  }

  setLLMConfig(config: Partial<LLMConfig>): void {
    const current = this.store.get('llm');
    this.store.set('llm', { ...current, ...config });
  }

  setProcessingConfig(config: Partial<ProcessingConfig>): void {
    const current = this.store.get('processing');
    this.store.set('processing', { ...current, ...config });
  }

  setUIConfig(config: Partial<UIConfig>): void {
    const current = this.store.get('ui');
    this.store.set('ui', { ...current, ...config });
  }

  setKnobs(knobs: Partial<SmartKnobs>): void {
    const current = this.store.get('knobs');
    this.store.set('knobs', { ...current, ...knobs });
  }

  applyPreset(presetName: keyof typeof PRESETS): void {
    const preset = PRESETS[presetName];
    if (preset) {
      this.store.set('processing', preset.processing);
      this.store.set('knobs', preset.knobs);
    }
  }

  isEmailConfigured(): boolean {
    const email = this.store.get('email');
    return !!(email?.auth?.user && (email?.auth?.password || email?.auth?.accessToken));
  }

  isLLMConfigured(): boolean {
    const llm = this.store.get('llm');
    return !!llm?.apiKey;
  }

  isReady(): boolean {
    return this.isEmailConfigured() && this.isLLMConfigured();
  }

  clearEmailConfig(): void {
    this.store.delete('email');
  }

  clearAll(): void {
    this.store.clear();
  }
}

export const configManager = ConfigManager.getInstance();
