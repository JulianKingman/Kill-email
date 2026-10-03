/**
 * Configuration Routes
 */

import { Router } from 'express';
import { configManager } from '../config/manager';
import { PRESETS, KNOB_DESCRIPTIONS } from '../config/defaults';
import { ConfigResponse } from '@kill-email/shared';

export const configRouter = Router();

// GET /api/config - Get current configuration
configRouter.get('/', (req, res) => {
  const config = configManager.getConfig();
  const knobs = configManager.getKnobs();

  const response: ConfigResponse = {
    email: config.email
      ? { provider: config.email.provider, user: config.email.auth?.user }
      : null,
    processing: config.processing!,
    ui: config.ui!,
    knobs,
    status: {
      emailConfigured: configManager.isEmailConfigured(),
      llmConfigured: configManager.isLLMConfigured(),
      ready: configManager.isReady(),
    },
  };

  res.json(response);
});

// POST /api/config - Update configuration
configRouter.post('/', (req, res) => {
  const { processing, ui, knobs } = req.body;

  if (processing) {
    configManager.setProcessingConfig(processing);
  }
  if (ui) {
    configManager.setUIConfig(ui);
  }
  if (knobs) {
    configManager.setKnobs(knobs);
  }

  res.json({ success: true });
});

// POST /api/config/preset - Apply a preset
configRouter.post('/preset', (req, res): void => {
  const { preset } = req.body;

  if (!preset || !PRESETS[preset as keyof typeof PRESETS]) {
    res.status(400).json({ error: 'Invalid preset' });
    return;
  }

  configManager.applyPreset(preset as keyof typeof PRESETS);
  res.json({ success: true, preset });
});

// GET /api/config/presets - Get available presets
configRouter.get('/presets', (req, res) => {
  const presets = Object.entries(PRESETS).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: value.description,
  }));
  res.json(presets);
});

// GET /api/config/knobs - Get knob descriptions
configRouter.get('/knobs', (req, res) => {
  res.json(KNOB_DESCRIPTIONS);
});
