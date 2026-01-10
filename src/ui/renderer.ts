/**
 * KILL ALL EMAIL - Terminal Renderer
 * "Come with me if you want your inbox to live"
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { VisualEffects, getEffects } from './effects';
import { THEMES, ASCII_ART, STATUS_ICONS, ThemeColors } from './theme';
import { ProcessingStats, EmailFate, CategoryDecision, ProcessingPhase } from '../types';

export class TerminalRenderer {
  private effects: VisualEffects;
  private theme: ThemeColors;
  private spinner: Ora | null = null;
  private width: number;
  private animationInterval: NodeJS.Timeout | null = null;
  private tickCount = 0;

  constructor(themeName: string = 'terminator') {
    this.effects = getEffects(themeName);
    this.theme = THEMES[themeName] || THEMES.terminator;
    this.width = process.stdout.columns || 80;
  }

  // Clear screen and show logo
  showSplash(): void {
    console.clear();
    console.log(this.effects.renderLogo(true));
    console.log();
    console.log(this.centerText(this.theme.muted('[ INBOX TERMINATION SYSTEM v1.0 ]')));
    console.log(this.centerText(this.theme.danger('"I\'ll be back... for your spam"')));
    console.log();
    console.log(this.effects.divider(this.width));
  }

  // Show startup sequence
  async showStartupSequence(): Promise<void> {
    console.clear();
    console.log(this.effects.renderLogo());
    console.log();

    const messages = [
      { text: 'INITIALIZING NEURAL NETWORK...', delay: 300 },
      { text: 'LOADING TERMINATION PROTOCOLS...', delay: 200 },
      { text: 'SCANNING FOR TARGETS...', delay: 400 },
      { text: 'SYSTEM ONLINE', delay: 100 },
    ];

    for (const msg of messages) {
      process.stdout.write(this.theme.primary('> '));
      await this.typeText(msg.text, 20);
      console.log(this.theme.success(' ✓'));
      await this.sleep(msg.delay);
    }

    console.log();
    console.log(this.effects.divider(this.width));
    console.log();
  }

  // Type text with typewriter effect
  private async typeText(text: string, speed: number = 30): Promise<void> {
    for (const char of text) {
      process.stdout.write(this.theme.text(char));
      await this.sleep(speed);
    }
  }

  // Center text
  private centerText(text: string): string {
    const stripped = text.replace(/\x1B\[[0-9;]*m/g, '');
    const padding = Math.max(0, Math.floor((this.width - stripped.length) / 2));
    return ' '.repeat(padding) + text;
  }

  // Sleep helper
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Start spinner with message
  startSpinner(message: string): void {
    this.spinner = ora({
      text: message,
      spinner: {
        interval: 80,
        frames: ['◐', '◓', '◑', '◒'],
      },
      color: 'red',
    }).start();
  }

  // Update spinner text
  updateSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  // Stop spinner with success
  spinnerSuccess(message: string): void {
    if (this.spinner) {
      this.spinner.succeed(this.theme.success(message));
      this.spinner = null;
    }
  }

  // Stop spinner with failure
  spinnerFail(message: string): void {
    if (this.spinner) {
      this.spinner.fail(this.theme.danger(message));
      this.spinner = null;
    }
  }

  // Stop spinner
  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  // Show phase header
  showPhaseHeader(phase: ProcessingPhase): void {
    const phaseNames: Record<ProcessingPhase, string> = {
      [ProcessingPhase.INITIALIZING]: '[ INITIALIZING ]',
      [ProcessingPhase.CONNECTING]: '[ ESTABLISHING CONNECTION ]',
      [ProcessingPhase.SCANNING]: '[ SCANNING INBOX ]',
      [ProcessingPhase.CATEGORIZING]: '[ CATEGORIZING TARGETS ]',
      [ProcessingPhase.ESCALATING]: '[ ESCALATING COMPLEX CASES ]',
      [ProcessingPhase.REVIEWING]: '[ HUMAN REVIEW REQUIRED ]',
      [ProcessingPhase.EXECUTING]: '[ EXECUTING TERMINATION ]',
      [ProcessingPhase.COMPLETE]: '[ MISSION COMPLETE ]',
      [ProcessingPhase.ERROR]: '[ SYSTEM ERROR ]',
    };

    console.log();
    console.log(this.effects.divider(this.width));
    console.log(this.centerText(this.theme.accent(phaseNames[phase])));
    console.log(this.effects.divider(this.width));
    console.log();
  }

  // Show email being processed
  showEmailProcessing(subject: string, from: string, index: number, total: number): void {
    const truncatedSubject = subject.length > 40 ? subject.substring(0, 37) + '...' : subject;
    const truncatedFrom = from.length > 25 ? from.substring(0, 22) + '...' : from;

    console.log(
      this.theme.muted(`[${String(index).padStart(4)}/${total}]`) +
      ' ' +
      this.theme.primary(STATUS_ICONS.processing) +
      ' ' +
      this.theme.text(truncatedSubject) +
      ' ' +
      this.theme.muted(`<${truncatedFrom}>`)
    );
  }

  // Show decision made
  showDecision(decision: CategoryDecision, subject: string): void {
    const fateIcon = this.effects.fateIcon(decision.fate);
    const confidence = `${(decision.confidence * 100).toFixed(0)}%`;
    const truncatedSubject = subject.length > 35 ? subject.substring(0, 32) + '...' : subject;

    let fateText: string;
    switch (decision.fate) {
      case EmailFate.TERMINATE:
        fateText = this.theme.danger('TERMINATE');
        break;
      case EmailFate.ESCALATE:
        fateText = this.theme.warning('ESCALATE');
        break;
      case EmailFate.HUMAN_REVIEW:
        fateText = this.theme.accent('HUMAN REVIEW');
        break;
      default:
        if (decision.fate.startsWith('ARCHIVE_')) {
          fateText = this.theme.secondary(decision.fate.replace('ARCHIVE_', 'ARCHIVE: '));
        } else if (decision.fate.startsWith('KEEP_')) {
          fateText = this.theme.success(decision.fate.replace('KEEP_', 'KEEP: '));
        } else {
          fateText = this.theme.text(decision.fate);
        }
    }

    console.log(
      `  ${fateIcon} ` +
      fateText.padEnd(25) +
      this.theme.muted(`[${confidence}]`) +
      ' ' +
      this.theme.text(truncatedSubject)
    );
  }

  // Show progress bar
  showProgress(current: number, total: number, label: string = 'Progress'): void {
    const bar = this.effects.progressBar(current, total, 40);
    process.stdout.write(`\r${this.theme.text(label)}: ${bar}`);
  }

  // Show stats summary
  showStats(stats: ProcessingStats): void {
    console.log();
    console.log(this.effects.drawBox('MISSION REPORT', this.effects.renderStats({
      terminated: stats.terminated,
      archived: stats.archived,
      kept: stats.kept,
      escalated: stats.escalated,
      bytesFreed: stats.bytesFreed,
    }), 50));
    console.log();

    const duration = (stats.processingTimeMs / 1000).toFixed(1);
    console.log(this.theme.muted(`  Processing time: ${duration}s`));
    console.log(this.theme.muted(`  Emails processed: ${stats.processed}/${stats.totalEmails}`));
  }

  // Show error
  showError(message: string, detail?: string): void {
    console.log();
    console.log(this.theme.danger(`${STATUS_ICONS.error} ERROR: ${message}`));
    if (detail) {
      console.log(this.theme.muted(`  ${detail}`));
    }
    console.log();
  }

  // Show warning
  showWarning(message: string): void {
    console.log(this.theme.warning(`${STATUS_ICONS.warning} ${message}`));
  }

  // Show info
  showInfo(message: string): void {
    console.log(this.theme.text(`${STATUS_ICONS.info} ${message}`));
  }

  // Show success
  showSuccess(message: string): void {
    console.log(this.theme.success(`${STATUS_ICONS.success} ${message}`));
  }

  // Show human review prompt
  showHumanReviewHeader(emailsCount: number): void {
    console.log();
    console.log(this.effects.drawBox(
      'HUMAN INTERVENTION REQUIRED',
      `${emailsCount} email(s) require your decision.\n` +
      'The AI was uncertain about these items.',
      55
    ));
    console.log();
  }

  // Show email details for review
  showEmailForReview(email: {
    subject: string;
    from: string;
    date: Date;
    snippet: string;
  }, reasoning: string): void {
    console.log(this.theme.accent('─'.repeat(60)));
    console.log(this.theme.text(`Subject: ${email.subject}`));
    console.log(this.theme.muted(`From: ${email.from}`));
    console.log(this.theme.muted(`Date: ${email.date.toLocaleDateString()}`));
    console.log();
    console.log(this.theme.text('Preview:'));
    console.log(this.theme.muted(email.snippet.substring(0, 200)));
    console.log();
    console.log(this.theme.warning('AI Analysis:'));
    console.log(this.theme.muted(reasoning));
    console.log(this.theme.accent('─'.repeat(60)));
  }

  // Start wave animation in footer
  startWaveAnimation(): void {
    if (this.animationInterval) return;

    this.animationInterval = setInterval(() => {
      this.tickCount++;
      process.stdout.write(`\r${this.effects.getWaveFrame(this.tickCount, 60)}`);
    }, 100);
  }

  // Stop wave animation
  stopWaveAnimation(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
    }
  }

  // Show termination summary
  showTerminationSummary(count: number): void {
    console.log();
    console.log(this.theme.danger(ASCII_ART.terminate));
    console.log(this.centerText(this.theme.danger.bold(`${count} EMAILS TERMINATED`)));
    console.log();
    console.log(this.centerText(this.theme.accent('"Hasta la vista, spam"')));
    console.log();
  }

  // Show configuration menu header
  showMenuHeader(title: string): void {
    console.clear();
    console.log(this.theme.primary(ASCII_ART.logo.split('\n').slice(0, 5).join('\n')));
    console.log();
    console.log(this.effects.divider(this.width));
    console.log(this.centerText(this.theme.accent(`[ ${title} ]`)));
    console.log(this.effects.divider(this.width));
    console.log();
  }

  // Show knob value
  showKnobValue(name: string, value: number | string, min?: number, max?: number): void {
    let valueStr: string;
    if (typeof value === 'number' && min !== undefined && max !== undefined) {
      const barWidth = 20;
      const filled = Math.round(((value - min) / (max - min)) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      valueStr = `[${bar}] ${value}`;
    } else {
      valueStr = String(value);
    }

    console.log(`  ${this.theme.text(name.padEnd(25))} ${this.theme.accent(valueStr)}`);
  }

  // Show dry run warning
  showDryRunWarning(): void {
    console.log();
    console.log(this.effects.drawBox(
      '⚠ DRY RUN MODE',
      'No emails will be modified.\n' +
      'This is a preview of what would happen.',
      50
    ));
    console.log();
  }
}

// Singleton
let rendererInstance: TerminalRenderer | null = null;

export function getRenderer(theme?: string): TerminalRenderer {
  if (!rendererInstance || theme) {
    rendererInstance = new TerminalRenderer(theme);
  }
  return rendererInstance;
}
