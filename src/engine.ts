/**
 * KILL ALL EMAIL - Processing Engine
 * "I'm a cybernetic organism. Email processor. Learning computer."
 */

import { EventEmitter } from 'events';
import { ImapClient } from './email/imap-client';
import { EmailOrganizer } from './email/organizer';
import { EmailCategorizer } from './llm/categorizer';
import { getRenderer, TerminalRenderer } from './ui/renderer';
import { getEffects } from './ui/effects';
import {
  EmailMessage,
  EmailFate,
  CategoryDecision,
  PendingAction,
  ProcessingStats,
  ProcessingPhase,
  SessionState,
  KillEmailConfig,
  SmartKnobs,
} from './types';

export interface EngineEvents {
  'phase-change': (phase: ProcessingPhase) => void;
  'email-processed': (email: EmailMessage, decision: CategoryDecision) => void;
  'batch-complete': (stats: Partial<ProcessingStats>) => void;
  'escalation': (emails: EmailMessage[]) => void;
  'error': (error: Error) => void;
  'complete': (stats: ProcessingStats) => void;
}

export interface ProcessingOptions {
  folder?: string;
  limit?: number;
  dryRun?: boolean;
  onHumanReview?: (
    email: EmailMessage,
    decision: CategoryDecision
  ) => Promise<EmailFate>;
}

export class TerminationEngine extends EventEmitter {
  private config: KillEmailConfig;
  private knobs: SmartKnobs;
  private client: ImapClient | null = null;
  private categorizer: EmailCategorizer;
  private organizer: EmailOrganizer | null = null;
  private renderer: TerminalRenderer;
  private state: SessionState;

  constructor(config: KillEmailConfig, knobs: SmartKnobs) {
    super();
    this.config = config;
    this.knobs = knobs;
    this.categorizer = new EmailCategorizer(
      config.llm,
      knobs,
      config.processing
    );
    this.renderer = getRenderer(config.ui.theme);
    this.state = this.initializeState();
  }

  private initializeState(): SessionState {
    return {
      startTime: new Date(),
      emailsScanned: 0,
      decisions: [],
      pendingActions: [],
      stats: {
        totalEmails: 0,
        processed: 0,
        terminated: 0,
        archived: 0,
        kept: 0,
        escalated: 0,
        humanReview: 0,
        bytesFreed: 0,
        processingTimeMs: 0,
      },
      currentPhase: ProcessingPhase.INITIALIZING,
    };
  }

  // Main processing pipeline
  async run(options: ProcessingOptions = {}): Promise<ProcessingStats> {
    const {
      folder = 'INBOX',
      limit = this.config.processing.maxEmailsPerRun,
      dryRun = this.config.processing.dryRun,
      onHumanReview,
    } = options;

    this.state = this.initializeState();

    try {
      // Phase 1: Connect
      await this.connectPhase();

      // Phase 2: Scan
      const emails = await this.scanPhase(folder, limit);

      // Phase 3: Categorize
      const { decisions, escalated, humanReview } = await this.categorizePhase(emails);

      // Phase 4: Escalate (if needed)
      const escalatedDecisions = await this.escalatePhase(escalated);
      decisions.push(...escalatedDecisions);

      // Phase 5: Human Review (if needed)
      if (humanReview.length > 0 && onHumanReview) {
        const humanDecisions = await this.humanReviewPhase(humanReview, onHumanReview);
        decisions.push(...humanDecisions);
      }

      // Phase 6: Execute (if not dry run)
      await this.executePhase(decisions, emails, dryRun);

      // Complete
      this.setPhase(ProcessingPhase.COMPLETE);
      this.state.stats.processingTimeMs = Date.now() - this.state.startTime.getTime();

      this.emit('complete', this.state.stats);
      return this.state.stats;
    } catch (err) {
      this.setPhase(ProcessingPhase.ERROR);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      await this.disconnect();
    }
  }

  // Phase 1: Connect to email server
  private async connectPhase(): Promise<void> {
    this.setPhase(ProcessingPhase.CONNECTING);
    this.renderer.startSpinner('Establishing connection to mail server...');

    this.client = new ImapClient(this.config.email);
    await this.client.connect();

    this.organizer = new EmailOrganizer(
      this.client,
      this.config.categories,
      this.config.email.folders
    );

    this.renderer.spinnerSuccess('Connection established');
  }

  // Phase 2: Scan for emails
  private async scanPhase(folder: string, limit: number): Promise<EmailMessage[]> {
    this.setPhase(ProcessingPhase.SCANNING);
    this.renderer.showPhaseHeader(ProcessingPhase.SCANNING);
    this.renderer.startSpinner(`Scanning ${folder}...`);

    if (!this.client) {
      throw new Error('Not connected');
    }

    const emails = await this.client.fetchEmails({
      mailbox: folder,
      limit,
      all: true,
    });

    this.state.emailsScanned = emails.length;
    this.state.stats.totalEmails = emails.length;

    this.renderer.spinnerSuccess(`Found ${emails.length} emails to analyze`);

    return emails;
  }

  // Phase 3: Categorize emails
  private async categorizePhase(
    emails: EmailMessage[]
  ): Promise<{
    decisions: CategoryDecision[];
    escalated: EmailMessage[];
    humanReview: EmailMessage[];
  }> {
    this.setPhase(ProcessingPhase.CATEGORIZING);
    this.renderer.showPhaseHeader(ProcessingPhase.CATEGORIZING);

    // First, apply quick rules
    const { obvious, needsLLM } = this.categorizer.preFilterEmails(emails);

    this.renderer.showInfo(
      `Quick filter: ${obvious.length} obvious, ${needsLLM.length} need AI analysis`
    );

    const decisions: CategoryDecision[] = [...obvious];
    const escalated: EmailMessage[] = [];
    const humanReview: EmailMessage[] = [];

    // Process through LLM
    if (needsLLM.length > 0) {
      this.renderer.startSpinner('Analyzing emails with AI...');

      const result = await this.categorizer.categorizeBatch(needsLLM, false);

      for (const decision of result.decisions) {
        if (decision.fate === EmailFate.HUMAN_REVIEW) {
          const email = emails.find((e) => e.id === decision.emailId);
          if (email) humanReview.push(email);
        } else {
          decisions.push(decision);
        }

        this.state.stats.processed++;
        this.emit('email-processed', emails.find((e) => e.id === decision.emailId)!, decision);
      }

      escalated.push(...result.escalated);
      this.state.stats.escalated = escalated.length;

      this.renderer.spinnerSuccess(
        `Analyzed ${result.decisions.length} emails, ${escalated.length} escalated`
      );
    }

    // Show summary
    this.showDecisionSummary(decisions);

    return { decisions, escalated, humanReview };
  }

  // Phase 4: Escalate uncertain emails to smarter model
  private async escalatePhase(escalated: EmailMessage[]): Promise<CategoryDecision[]> {
    if (escalated.length === 0) {
      return [];
    }

    this.setPhase(ProcessingPhase.ESCALATING);
    this.renderer.showPhaseHeader(ProcessingPhase.ESCALATING);
    this.renderer.showInfo(`${escalated.length} emails require deeper analysis`);
    this.renderer.startSpinner('Engaging smart model...');

    const result = await this.categorizer.categorizeBatch(escalated, true);

    this.renderer.spinnerSuccess(`Smart model analyzed ${result.decisions.length} emails`);

    return result.decisions;
  }

  // Phase 5: Human review
  private async humanReviewPhase(
    emails: EmailMessage[],
    onReview: (email: EmailMessage, decision: CategoryDecision) => Promise<EmailFate>
  ): Promise<CategoryDecision[]> {
    this.setPhase(ProcessingPhase.REVIEWING);
    this.renderer.showPhaseHeader(ProcessingPhase.REVIEWING);
    this.renderer.showHumanReviewHeader(emails.length);

    const decisions: CategoryDecision[] = [];

    for (const email of emails) {
      const placeholderDecision: CategoryDecision = {
        emailId: email.id,
        fate: EmailFate.HUMAN_REVIEW,
        confidence: 0,
        reasoning: 'Requires human decision',
        modelUsed: 'human',
        timestamp: new Date(),
      };

      const fate = await onReview(email, placeholderDecision);

      decisions.push({
        ...placeholderDecision,
        fate,
        confidence: 1.0,
        reasoning: 'Human decision',
      });

      this.state.stats.humanReview++;
    }

    return decisions;
  }

  // Phase 6: Execute actions
  private async executePhase(
    decisions: CategoryDecision[],
    emails: EmailMessage[],
    dryRun: boolean
  ): Promise<void> {
    this.setPhase(ProcessingPhase.EXECUTING);
    this.renderer.showPhaseHeader(ProcessingPhase.EXECUTING);

    if (!this.organizer) {
      throw new Error('Organizer not initialized');
    }

    // Convert to actions
    const actions = this.organizer.decisionsToActions(decisions);
    const summary = this.organizer.getActionSummary(actions);

    this.renderer.showInfo(
      `Actions: ${summary.deleteCount} delete, ${summary.archiveCount} archive, ${summary.labelCount + summary.moveCount} organize`
    );

    if (dryRun) {
      this.renderer.showDryRunWarning();

      // Show preview
      const emailMap = new Map(emails.map((e) => [e.id, e]));
      const preview = this.organizer.previewActions(actions, emailMap);

      if (preview.toDelete.length > 0) {
        console.log();
        this.renderer.showWarning('Would DELETE:');
        for (const item of preview.toDelete.slice(0, 10)) {
          console.log(`  ${this.renderer['theme'].danger('✖')} ${item.subject.substring(0, 50)}`);
        }
        if (preview.toDelete.length > 10) {
          console.log(`  ... and ${preview.toDelete.length - 10} more`);
        }
      }

      // Update stats for preview
      this.state.stats.terminated = summary.deleteCount;
      this.state.stats.archived = summary.archiveCount;
      this.state.stats.kept = summary.labelCount + summary.moveCount;

      return;
    }

    // Execute for real
    const confirmedActions = this.organizer.confirmAllActions(actions);
    const emailMap = new Map(emails.map((e) => [e.id, e]));

    this.renderer.startSpinner('Executing termination protocol...');

    const result = await this.organizer.executeActions(
      confirmedActions,
      emailMap,
      (current, total, action) => {
        this.renderer.updateSpinner(
          `Executing ${current}/${total}: ${action.action}`
        );
      }
    );

    this.state.stats = { ...this.state.stats, ...result.stats };

    if (result.failed.length > 0) {
      this.renderer.spinnerFail(`Completed with ${result.failed.length} errors`);
      for (const fail of result.failed) {
        this.renderer.showError(`Failed: ${fail.action.emailId}`, fail.error);
      }
    } else {
      this.renderer.spinnerSuccess('Termination protocol complete');
    }
  }

  // Show summary of decisions
  private showDecisionSummary(decisions: CategoryDecision[]): void {
    const counts = new Map<EmailFate, number>();
    for (const d of decisions) {
      counts.set(d.fate, (counts.get(d.fate) || 0) + 1);
    }

    console.log();
    this.renderer.showInfo('Decision summary:');
    for (const [fate, count] of counts) {
      const icon = getEffects().fateIcon(fate);
      console.log(`  ${icon} ${fate}: ${count}`);
    }
    console.log();
  }

  // Set current phase
  private setPhase(phase: ProcessingPhase): void {
    this.state.currentPhase = phase;
    this.emit('phase-change', phase);
  }

  // Disconnect from server
  private async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  // Get current state
  getState(): SessionState {
    return this.state;
  }

  // Get current stats
  getStats(): ProcessingStats {
    return this.state.stats;
  }
}
