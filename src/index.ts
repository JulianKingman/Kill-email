#!/usr/bin/env node
/**
 * ██╗  ██╗██╗██╗     ██╗          █████╗ ██╗     ██╗
 * ██║ ██╔╝██║██║     ██║         ██╔══██╗██║     ██║
 * █████╔╝ ██║██║     ██║         ███████║██║     ██║
 * ██╔═██╗ ██║██║     ██║         ██╔══██║██║     ██║
 * ██║  ██╗██║███████╗███████╗    ██║  ██║███████╗███████╗
 * ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝    ╚═╝  ╚═╝╚══════╝╚══════╝
 *
 *            ███████╗███╗   ███╗ █████╗ ██╗██╗
 *            ██╔════╝████╗ ████║██╔══██╗██║██║
 *            █████╗  ██╔████╔██║███████║██║██║
 *            ██╔══╝  ██║╚██╔╝██║██╔══██║██║██║
 *            ███████╗██║ ╚═╝ ██║██║  ██║██║███████╗
 *            ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
 *
 * "I'll be back... for your spam"
 *
 * KILL ALL EMAIL - Inbox Termination System v1.0
 * AI-powered email organization and cleanup
 */

import chalk from 'chalk';
import { getConfigManager, ConfigManager } from './config/manager';
import { getRenderer } from './ui/renderer';
import { TerminationEngine } from './engine';
import {
  showMainMenu,
  setupEmailConnection,
  setupApiKey,
  configureSettings,
  showHelp,
  selectProcessingOptions,
  confirmExecution,
  humanReviewPrompt,
} from './ui/prompts';
import { EmailFate, EmailMessage, CategoryDecision } from './types';

class KillAllEmail {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = getConfigManager();
  }

  async run(): Promise<void> {
    const renderer = getRenderer('terminator');

    // Show startup sequence
    await renderer.showStartupSequence();

    // Main loop
    let running = true;
    while (running) {
      const action = await showMainMenu();

      switch (action) {
        case 'run':
          await this.runTermination();
          break;

        case 'settings':
          await this.configureSettings();
          break;

        case 'email':
          await this.setupEmail();
          break;

        case 'apikey':
          await this.setupApiKey();
          break;

        case 'stats':
          await this.showStats();
          break;

        case 'help':
          await showHelp();
          break;

        case 'exit':
          running = false;
          break;
      }
    }

    // Exit message
    console.log();
    console.log(chalk.red('Hasta la vista, baby.'));
    console.log();
  }

  private async runTermination(): Promise<void> {
    const renderer = getRenderer();
    const status = this.configManager.getConfigStatus();

    if (!status.emailConfigured) {
      renderer.showError('Email not configured', 'Please setup email connection first');
      return;
    }

    if (!status.classifierConfigured) {
      renderer.showError(
        'Classifier not configured',
        'Set your Anthropic API key, or point SYSTEMONE_BASE_URL at a Jev or Laya server'
      );
      return;
    }

    // Get processing options
    const options = await selectProcessingOptions();

    // Show splash
    renderer.showSplash();

    // Create engine
    const config = this.configManager.getConfig();
    const engine = new TerminationEngine(config, config.knobs);

    try {
      // Run with human review callback
      const stats = await engine.run({
        folder: options.folder,
        limit: options.limit,
        dryRun: options.dryRun,
        onHumanReview: async (
          email: EmailMessage,
          decision: CategoryDecision
        ): Promise<EmailFate> => {
          const questions = await engine.reviewQuestions(email);

          return humanReviewPrompt(
            {
              subject: email.subject,
              from: email.from[0]?.address || 'unknown',
              snippet: email.snippet,
            },
            decision.reasoning,
            questions
          );
        },
      });

      // Show final stats
      renderer.showStats(stats);

      if (!options.dryRun && stats.terminated > 0) {
        renderer.showTerminationSummary(stats.terminated);
      }
    } catch (err) {
      renderer.showError(
        'Termination failed',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  private async setupEmail(): Promise<void> {
    const config = await setupEmailConnection();
    if (config) {
      this.configManager.setEmailConnection(config);
    }
  }

  private async setupApiKey(): Promise<void> {
    const key = await setupApiKey();
    if (key) {
      this.configManager.setApiKey(key);
    }
  }

  private async configureSettings(): Promise<void> {
    const knobs = this.configManager.getKnobs();
    const result = await configureSettings(knobs);

    if (result?.preset) {
      this.configManager.applyPreset(result.preset as any);
    }

    if (result?.knobs) {
      this.configManager.setKnobs(result.knobs);
    }
  }

  private async showStats(): Promise<void> {
    const renderer = getRenderer();
    renderer.showMenuHeader('MISSION STATISTICS');

    const configPath = this.configManager.getPath();
    const status = this.configManager.getConfigStatus();

    console.log(chalk.gray('Configuration:'));
    console.log(chalk.gray(`  Path: ${configPath}`));
    console.log(
      chalk.gray(`  Email: ${status.emailConfigured ? chalk.green('Configured') : chalk.red('Not configured')}`)
    );
    console.log(
      chalk.gray(`  API Key: ${status.llmConfigured ? chalk.green('Configured') : chalk.red('Not configured')}`)
    );
    const { classifier } = this.configManager.getConfig();
    console.log(
      chalk.gray(
        `  Classifier: ${classifier.primary === 'system-one' ? `system-one (${classifier.systemOne.baseUrl})` : 'Claude'}`
      )
    );
    console.log();

    // Show current settings
    const config = this.configManager.export();
    console.log(chalk.gray('Current Settings:'));
    console.log(chalk.gray(`  Aggressiveness: ${config.processing?.aggressiveness || 5}`));
    console.log(chalk.gray(`  Dry Run: ${config.processing?.dryRun ? 'Yes' : 'No'}`));
    console.log(chalk.gray(`  Theme: ${config.ui?.theme || 'terminator'}`));
    console.log();

    // Wait for input
    const inquirer = await import('inquirer');
    await inquirer.default.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.gray('Press Enter to continue...'),
        prefix: '',
      },
    ]);
  }
}

// CLI argument handling
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.red('KILL ALL EMAIL')} - Inbox Termination System

Usage:
  kill-email              Start interactive mode
  kill-email --help       Show this help
  kill-email --version    Show version
  kill-email --reset      Reset all configuration

Options:
  --dry-run               Preview mode, no changes made
  --aggressive            Use aggressive preset
  --folder <name>         Scan specific folder
  --limit <number>        Limit emails to process

Environment Variables:
  ANTHROPIC_API_KEY       Anthropic API key (used for this run, not saved)
  KILL_EMAIL_CLASSIFIER   First-pass classifier: claude or system-one
  SYSTEMONE_BASE_URL      Jev or Laya server URL (default http://localhost:8000)
  SYSTEMONE_API_KEY       Bearer token for that server
  SYSTEMONE_MODEL         Model name to request from that server
  KILL_EMAIL_THEME        Set theme (terminator, matrix, amber, green)
`);
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('KILL ALL EMAIL v1.0.0');
    return;
  }

  if (args.includes('--reset')) {
    const configManager = getConfigManager();
    configManager.reset();
    console.log(chalk.green('Configuration reset.'));
    return;
  }

  // API keys and classifier settings from the environment are read per run by ConfigManager
  const configManager = getConfigManager();

  if (process.env.KILL_EMAIL_THEME) {
    const ui = configManager.get('ui');
    configManager.set('ui', { ...ui, theme: process.env.KILL_EMAIL_THEME as any });
  }

  // Apply CLI options
  if (args.includes('--aggressive')) {
    configManager.applyPreset('aggressive');
  }

  // Run the app
  const app = new KillAllEmail();
  await app.run();
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n✖ FATAL ERROR:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n✖ UNHANDLED REJECTION:'), reason);
  process.exit(1);
});

// Run
main().catch((err) => {
  console.error(chalk.red('Failed to start:'), err.message);
  process.exit(1);
});
