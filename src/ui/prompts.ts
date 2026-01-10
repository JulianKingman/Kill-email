/**
 * KILL ALL EMAIL - Interactive Prompts
 * "What is your mission, human?"
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { THEMES, ASCII_ART } from './theme';
import { getRenderer } from './renderer';
import {
  EmailFate,
  EmailConnectionConfig,
  SmartKnobs,
} from '../types';
import { PRESETS, KNOB_DESCRIPTIONS } from '../config/defaults';
import { GMAIL_CONFIG, OUTLOOK_CONFIG, YAHOO_CONFIG } from '../email/imap-client';

const theme = THEMES.terminator;

export async function showMainMenu(): Promise<string> {
  const renderer = getRenderer();
  renderer.showMenuHeader('MAIN TERMINAL');

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: theme.accent('Select mission:'),
      choices: [
        { name: theme.danger('⚔  TERMINATE INBOX'), value: 'run' },
        { name: theme.secondary('⚙  Configure Settings'), value: 'settings' },
        { name: theme.text('📧  Setup Email Connection'), value: 'email' },
        { name: theme.text('🔑  Set API Key'), value: 'apikey' },
        { name: theme.muted('📊  View Statistics'), value: 'stats' },
        { name: theme.muted('❓  Help'), value: 'help' },
        { name: theme.muted('✖  Exit'), value: 'exit' },
      ],
      prefix: theme.primary('►'),
    },
  ]);

  return action;
}

export async function setupEmailConnection(): Promise<EmailConnectionConfig | null> {
  const renderer = getRenderer();
  renderer.showMenuHeader('EMAIL CONNECTION SETUP');

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: theme.accent('Select email provider:'),
      choices: [
        { name: 'Gmail', value: 'gmail' },
        { name: 'Outlook / Office 365', value: 'outlook' },
        { name: 'Yahoo Mail', value: 'yahoo' },
        { name: 'Other (Custom IMAP)', value: 'custom' },
        { name: theme.muted('← Back'), value: 'back' },
      ],
      prefix: theme.primary('►'),
    },
  ]);

  if (provider === 'back') {
    return null;
  }

  let baseConfig: Partial<EmailConnectionConfig>;

  switch (provider) {
    case 'gmail':
      baseConfig = GMAIL_CONFIG;
      console.log();
      console.log(theme.warning('📝 For Gmail, you need an App Password:'));
      console.log(theme.muted('   1. Go to myaccount.google.com'));
      console.log(theme.muted('   2. Security → 2-Step Verification → App passwords'));
      console.log(theme.muted('   3. Generate a new app password for "Mail"'));
      console.log();
      break;
    case 'outlook':
      baseConfig = OUTLOOK_CONFIG;
      break;
    case 'yahoo':
      baseConfig = YAHOO_CONFIG;
      console.log();
      console.log(theme.warning('📝 For Yahoo, you need an App Password:'));
      console.log(theme.muted('   1. Go to login.yahoo.com/account/security'));
      console.log(theme.muted('   2. Generate app password'));
      console.log();
      break;
    default:
      baseConfig = {};
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      message: theme.text('Email address:'),
      validate: (input) => input.includes('@') || 'Please enter a valid email',
      prefix: theme.primary('►'),
    },
    {
      type: 'password',
      name: 'password',
      message: theme.text('Password (or App Password):'),
      mask: '*',
      prefix: theme.primary('►'),
    },
    ...(provider === 'custom'
      ? [
          {
            type: 'input',
            name: 'host',
            message: theme.text('IMAP Server:'),
            default: 'imap.example.com',
            prefix: theme.primary('►'),
          },
          {
            type: 'number',
            name: 'port',
            message: theme.text('IMAP Port:'),
            default: 993,
            prefix: theme.primary('►'),
          },
          {
            type: 'confirm',
            name: 'tls',
            message: theme.text('Use TLS/SSL?'),
            default: true,
            prefix: theme.primary('►'),
          },
        ]
      : []),
  ]);

  const config: EmailConnectionConfig = {
    provider: provider === 'custom' ? 'imap' : provider,
    imap: provider === 'custom'
      ? { host: answers.host, port: answers.port, tls: answers.tls }
      : baseConfig.imap!,
    auth: {
      user: answers.email,
      password: answers.password,
    },
    folders: baseConfig.folders || {
      inbox: 'INBOX',
      archive: 'Archive',
      trash: 'Trash',
    },
  };

  console.log();
  console.log(theme.success('✓ Email configuration saved'));

  return config;
}

export async function setupApiKey(): Promise<string | null> {
  const renderer = getRenderer();
  renderer.showMenuHeader('API KEY SETUP');

  console.log(theme.text('To categorize emails, we need an Anthropic API key.'));
  console.log(theme.muted('Get one at: https://console.anthropic.com'));
  console.log();

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: theme.text('Anthropic API Key:'),
      mask: '*',
      validate: (input) =>
        input.startsWith('sk-') || input === '' || 'API key should start with "sk-"',
      prefix: theme.primary('►'),
    },
  ]);

  if (!apiKey) {
    return null;
  }

  console.log();
  console.log(theme.success('✓ API key saved'));

  return apiKey;
}

export async function configureSettings(
  currentKnobs: SmartKnobs
): Promise<{ preset?: string; knobs?: Partial<SmartKnobs> } | null> {
  const renderer = getRenderer();
  renderer.showMenuHeader('SETTINGS CONFIGURATION');

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: theme.accent('Configure:'),
      choices: [
        { name: '🎯 Apply Preset', value: 'preset' },
        { name: '🔧 Tune Individual Knobs', value: 'knobs' },
        { name: '👁  View Current Settings', value: 'view' },
        { name: theme.muted('← Back'), value: 'back' },
      ],
      prefix: theme.primary('►'),
    },
  ]);

  if (action === 'back') {
    return null;
  }

  if (action === 'preset') {
    return await selectPreset();
  }

  if (action === 'view') {
    console.log();
    console.log(theme.accent('Current Settings:'));
    console.log(theme.muted('─'.repeat(40)));

    for (const [key, desc] of Object.entries(KNOB_DESCRIPTIONS)) {
      const value = (currentKnobs as any)[key];
      renderer.showKnobValue(desc.name, value, desc.min, desc.max);
    }

    console.log();
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: theme.muted('Press Enter to continue...'),
        prefix: '',
      },
    ]);

    return null;
  }

  if (action === 'knobs') {
    return await tuneKnobs(currentKnobs);
  }

  return null;
}

async function selectPreset(): Promise<{ preset: string } | null> {
  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: theme.accent('Select preset:'),
      choices: Object.entries(PRESETS).map(([key, value]) => ({
        name: `${value.name} - ${theme.muted(value.description)}`,
        value: key,
      })),
      prefix: theme.primary('►'),
    },
  ]);

  console.log();
  console.log(theme.success(`✓ Applied preset: ${PRESETS[preset as keyof typeof PRESETS].name}`));

  return { preset };
}

async function tuneKnobs(
  currentKnobs: SmartKnobs
): Promise<{ knobs: Partial<SmartKnobs> } | null> {
  const updates: Partial<SmartKnobs> = {};

  // Aggressiveness
  const { aggressiveness } = await inquirer.prompt([
    {
      type: 'number',
      name: 'aggressiveness',
      message: theme.text('Aggressiveness (1-10):'),
      default: 5,
      validate: (input) =>
        (input >= 1 && input <= 10) || 'Must be between 1 and 10',
      prefix: theme.primary('►'),
    },
  ]);

  // Delete confidence
  const { deleteConfidence } = await inquirer.prompt([
    {
      type: 'number',
      name: 'deleteConfidence',
      message: theme.text('Delete confidence threshold (0.5-1.0):'),
      default: currentKnobs.deleteConfidenceThreshold,
      validate: (input) =>
        (input >= 0.5 && input <= 1) || 'Must be between 0.5 and 1.0',
      prefix: theme.primary('►'),
    },
  ]);

  // Recent email protection
  const { protectRecent } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'protectRecent',
      message: theme.text('Protect recent emails from deletion?'),
      default: currentKnobs.escalateOnRecent,
      prefix: theme.primary('►'),
    },
  ]);

  if (protectRecent) {
    const { recentDays } = await inquirer.prompt([
      {
        type: 'number',
        name: 'recentDays',
        message: theme.text('Protect emails newer than (days):'),
        default: currentKnobs.recentThresholdDays,
        validate: (input) => input >= 1 || 'Must be at least 1 day',
        prefix: theme.primary('►'),
      },
    ]);
    updates.recentThresholdDays = recentDays;
  }

  updates.deleteConfidenceThreshold = deleteConfidence;
  updates.escalateOnRecent = protectRecent;

  // Attachment protection
  const { protectAttachments } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'protectAttachments',
      message: theme.text('Escalate emails with attachments?'),
      default: currentKnobs.escalateOnAttachments,
      prefix: theme.primary('►'),
    },
  ]);

  updates.escalateOnAttachments = protectAttachments;

  console.log();
  console.log(theme.success('✓ Settings updated'));

  return { knobs: updates };
}

export async function confirmExecution(
  stats: { deleteCount: number; archiveCount: number }
): Promise<boolean> {
  console.log();
  console.log(
    theme.warning(
      `⚠  This will TERMINATE ${stats.deleteCount} emails and archive ${stats.archiveCount} emails.`
    )
  );
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: theme.danger('Execute termination protocol?'),
      default: false,
      prefix: theme.danger('⚠'),
    },
  ]);

  return confirm;
}

export async function humanReviewPrompt(
  email: { subject: string; from: string; snippet: string },
  reasoning: string,
  questions: string[]
): Promise<EmailFate> {
  const renderer = getRenderer();

  renderer.showEmailForReview(
    { ...email, date: new Date() },
    reasoning
  );

  console.log();
  console.log(theme.accent('Questions to consider:'));
  for (const q of questions) {
    console.log(theme.text(`  • ${q}`));
  }
  console.log();

  const { decision } = await inquirer.prompt([
    {
      type: 'list',
      name: 'decision',
      message: theme.accent('Your decision:'),
      choices: [
        { name: theme.danger('✖ TERMINATE - Delete this email'), value: EmailFate.TERMINATE },
        { name: theme.secondary('◉ ARCHIVE - Move to archive'), value: EmailFate.ARCHIVE_PERSONAL },
        { name: theme.success('★ KEEP - Keep in inbox'), value: EmailFate.KEEP_IMPORTANT },
        { name: theme.muted('→ SKIP - Decide later'), value: 'skip' },
      ],
      prefix: theme.primary('►'),
    },
  ]);

  return decision === 'skip' ? EmailFate.HUMAN_REVIEW : decision;
}

export async function selectProcessingOptions(): Promise<{
  dryRun: boolean;
  limit: number;
  folder: string;
}> {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dryRun',
      message: theme.text('Run in preview mode (no changes)?'),
      default: true,
      prefix: theme.primary('►'),
    },
    {
      type: 'number',
      name: 'limit',
      message: theme.text('Maximum emails to process:'),
      default: 100,
      validate: (input) => input > 0 || 'Must be greater than 0',
      prefix: theme.primary('►'),
    },
    {
      type: 'input',
      name: 'folder',
      message: theme.text('Folder to scan:'),
      default: 'INBOX',
      prefix: theme.primary('►'),
    },
  ]);

  return answers;
}

export async function showHelp(): Promise<void> {
  const renderer = getRenderer();
  renderer.showMenuHeader('HELP & DOCUMENTATION');

  console.log(theme.accent('KILL ALL EMAIL - Inbox Termination System'));
  console.log();
  console.log(theme.text('OVERVIEW:'));
  console.log(theme.muted('  This tool uses AI to categorize and organize your emails.'));
  console.log(theme.muted('  It can automatically delete spam and archive important messages.'));
  console.log();
  console.log(theme.text('CATEGORIES:'));
  console.log(theme.danger('  TERMINATE     - Delete immediately'));
  console.log(theme.secondary('  ARCHIVE_*     - Move to organized folders'));
  console.log(theme.success('  KEEP_*        - Keep in inbox with labels'));
  console.log(theme.warning('  ESCALATE      - Needs smarter AI analysis'));
  console.log(theme.accent('  HUMAN_REVIEW  - Requires your decision'));
  console.log();
  console.log(theme.text('PRESETS:'));
  console.log(theme.muted('  Conservative  - Very careful, minimal deletion'));
  console.log(theme.muted('  Balanced      - Good mix of cleanup and safety'));
  console.log(theme.muted('  Aggressive    - Fast cleanup, more deletion'));
  console.log(theme.danger('  TERMINATOR    - Maximum deletion, no mercy'));
  console.log();
  console.log(theme.text('SAFETY:'));
  console.log(theme.muted('  • Always runs in preview mode by default'));
  console.log(theme.muted('  • Requires confirmation before deletion'));
  console.log(theme.muted('  • Uncertain emails are escalated for review'));
  console.log(theme.muted('  • Important patterns trigger human review'));
  console.log();

  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: theme.muted('Press Enter to continue...'),
      prefix: '',
    },
  ]);
}
