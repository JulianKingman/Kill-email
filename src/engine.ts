/**
 * KILL ALL EMAIL - Processing Engine
 * "I'm a cybernetic organism. Email processor. Learning computer."
 */

import { EventEmitter } from 'events';
import { ImapClient } from './email/imap-client';
import { EmailOrganizer } from './email/organizer';
import { createClassifiers, Classification, Classifier, ClaudeClassifier } from './classify';
import { applyRules, decideFate, toDecision } from './policy';
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
  'classification-failed': (email: EmailMessage, classifier: string, error: string) => void;
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
  private primary: Classifier;
  private escalation: ClaudeClassifier | null;
  private organizer: EmailOrganizer | null = null;
  private renderer: TerminalRenderer;
  private state: SessionState;

  constructor(config: KillEmailConfig, knobs: SmartKnobs) {
    super();
    this.config = config;
    this.knobs = knobs;
    const tiers = createClassifiers(config, knobs);
    this.primary = tiers.primary;
    this.escalation = tiers.escalation;
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
      const escalatedResult = await this.escalatePhase(escalated);
      decisions.push(...escalatedResult.decisions);
      humanReview.push(...escalatedResult.humanReview);

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

    const decisions: CategoryDecision[] = [];
    const escalated: EmailMessage[] = [];
    const humanReview: EmailMessage[] = [];
    const needsModel: EmailMessage[] = [];
    const policy = {
      knobs: this.knobs,
      escalationThreshold: this.config.llm.escalationThreshold,
    };

    // First, apply the user's rules
    for (const email of emails) {
      const hit = applyRules(email, this.config.processing, this.knobs);
      if (!hit) {
        needsModel.push(email);
        continue;
      }
      const fate = hit.explicit
        ? hit.classification.category
        : decideFate(email, hit.classification, { ...policy, finalTier: true });
      this.route(email, hit.classification, fate, decisions, escalated, humanReview);
    }

    this.renderer.showInfo(
      `Rules: ${emails.length - needsModel.length} matched, ${needsModel.length} need ${this.primary.name}`
    );

    if (needsModel.length > 0) {
      this.renderer.startSpinner(`Classifying with ${this.primary.name}...`);

      const result = await this.primary.classify(needsModel);
      const byId = new Map(needsModel.map((e) => [e.id, e]));

      for (const classification of result.classifications) {
        const email = byId.get(classification.emailId);
        if (!email) continue;
        const fate = decideFate(email, classification, { ...policy, finalTier: !this.escalation });
        this.route(email, classification, fate, decisions, escalated, humanReview);
      }

      // Never drop an email because its request failed: a stronger model or a person decides
      for (const failure of result.failed) {
        const email = byId.get(failure.emailId);
        if (!email) continue;
        this.reportFailure(email, this.primary.name, failure.error);
        (this.escalation ? escalated : humanReview).push(email);
      }

      this.state.stats.escalated = escalated.length;
      const failedNote = result.failed.length > 0 ? `, ${result.failed.length} failed` : '';
      this.renderer.spinnerSuccess(
        `Classified ${result.classifications.length} emails, ${escalated.length} escalated${failedNote}`
      );
    }

    // Show summary
    this.showDecisionSummary(decisions);

    return { decisions, escalated, humanReview };
  }

  private reportFailure(email: EmailMessage, classifier: string, error: string): void {
    this.renderer.showWarning(`${classifier} could not classify "${email.subject}": ${error}`);
    this.emit('classification-failed', email, classifier, error);
  }

  // Sort one classified email into the right bucket
  private route(
    email: EmailMessage,
    classification: Classification,
    fate: EmailFate,
    decisions: CategoryDecision[],
    escalated: EmailMessage[],
    humanReview: EmailMessage[]
  ): void {
    if (fate === EmailFate.ESCALATE) {
      escalated.push(email);
      return;
    }
    if (fate === EmailFate.HUMAN_REVIEW) {
      humanReview.push(email);
      return;
    }
    const decision = toDecision(classification, fate);
    decisions.push(decision);
    this.state.stats.processed++;
    this.emit('email-processed', email, decision);
  }

  // Phase 4: Escalate uncertain emails to a stronger model
  private async escalatePhase(
    escalated: EmailMessage[]
  ): Promise<{ decisions: CategoryDecision[]; humanReview: EmailMessage[] }> {
    const decisions: CategoryDecision[] = [];
    const humanReview: EmailMessage[] = [];

    if (escalated.length === 0 || !this.escalation) {
      return { decisions, humanReview };
    }

    this.setPhase(ProcessingPhase.ESCALATING);
    this.renderer.showPhaseHeader(ProcessingPhase.ESCALATING);
    this.renderer.showInfo(`${escalated.length} emails require deeper analysis`);
    this.renderer.startSpinner(`Engaging ${this.escalation.name}...`);

    const result = await this.escalation.classify(escalated);
    const byId = new Map(escalated.map((e) => [e.id, e]));

    for (const classification of result.classifications) {
      const email = byId.get(classification.emailId);
      if (!email) continue;
      const fate = decideFate(email, classification, {
        knobs: this.knobs,
        escalationThreshold: this.config.llm.escalationThreshold,
        finalTier: true,
      });
      if (fate === EmailFate.HUMAN_REVIEW) {
        humanReview.push(email);
        continue;
      }
      const decision = toDecision(classification, fate, EmailFate.ESCALATE);
      decisions.push(decision);
      this.state.stats.processed++;
      this.emit('email-processed', email, decision);
    }

    for (const failure of result.failed) {
      const email = byId.get(failure.emailId);
      if (!email) continue;
      this.reportFailure(email, this.escalation.name, failure.error);
      humanReview.push(email);
    }

    this.renderer.spinnerSuccess(
      `${this.escalation.name} decided ${decisions.length}, ${humanReview.length} need a human`
    );

    return { decisions, humanReview };
  }

  // Questions shown during human review; the decision models write no text, so ask Claude
  async reviewQuestions(email: EmailMessage): Promise<string[]> {
    const fallback = [
      'Is this email important for future reference?',
      'Would you miss this if it were deleted?',
      'Does this contain information you might need later?',
    ];
    if (!this.escalation) return fallback;
    try {
      const questions = await this.escalation.reviewQuestions(email);
      return questions.length > 0 ? questions : fallback;
    } catch {
      return fallback;
    }
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
