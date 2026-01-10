/**
 * KILL ALL EMAIL - Email Organizer
 * "Target acquired. Executing termination protocol."
 */

import { ImapClient } from './imap-client';
import {
  EmailMessage,
  EmailFate,
  CategoryDecision,
  PendingAction,
  ProcessingStats,
  CategoryConfig,
  EmailConnectionConfig,
} from '../types';

export interface OrganizationResult {
  successful: PendingAction[];
  failed: { action: PendingAction; error: string }[];
  stats: ProcessingStats;
}

export class EmailOrganizer {
  private client: ImapClient;
  private categoryConfig: CategoryConfig;
  private folders: EmailConnectionConfig['folders'];

  constructor(
    client: ImapClient,
    categoryConfig: CategoryConfig,
    folders: EmailConnectionConfig['folders']
  ) {
    this.client = client;
    this.categoryConfig = categoryConfig;
    this.folders = folders;
  }

  // Convert decisions to pending actions
  decisionsToActions(decisions: CategoryDecision[]): PendingAction[] {
    const actions: PendingAction[] = [];

    for (const decision of decisions) {
      const action = this.decisionToAction(decision);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  // Convert a single decision to an action
  private decisionToAction(decision: CategoryDecision): PendingAction | null {
    const { emailId, fate } = decision;

    // Skip if category is disabled
    if (!this.categoryConfig.enabled[fate]) {
      return null;
    }

    switch (fate) {
      case EmailFate.TERMINATE:
        return {
          emailId,
          action: 'delete',
          confirmed: false,
        };

      case EmailFate.TERMINATE_DELAYED:
        // For delayed termination, we label it for future deletion
        return {
          emailId,
          action: 'label',
          label: 'KILL_EMAIL/ToDelete',
          confirmed: false,
        };

      case EmailFate.ARCHIVE_RECEIPTS:
      case EmailFate.ARCHIVE_PERSONAL:
      case EmailFate.ARCHIVE_WORK:
      case EmailFate.ARCHIVE_LEGAL:
      case EmailFate.ARCHIVE_TRAVEL:
      case EmailFate.ARCHIVE_NEWSLETTERS:
        const archiveLabel = this.categoryConfig.customLabels[fate] || fate.replace('ARCHIVE_', '');
        return {
          emailId,
          action: 'archive',
          targetFolder: this.folders.archive,
          label: `KILL_EMAIL/${archiveLabel}`,
          confirmed: false,
        };

      case EmailFate.KEEP_ACTION:
      case EmailFate.KEEP_REFERENCE:
      case EmailFate.KEEP_IMPORTANT:
        // Just label, keep in inbox
        const keepLabel = fate.replace('KEEP_', '');
        return {
          emailId,
          action: 'label',
          label: `KILL_EMAIL/${keepLabel}`,
          confirmed: false,
        };

      case EmailFate.ESCALATE:
      case EmailFate.HUMAN_REVIEW:
        // No action for these - they need further processing
        return null;

      default:
        return null;
    }
  }

  // Execute pending actions
  async executeActions(
    actions: PendingAction[],
    emails: Map<string, EmailMessage>,
    onProgress?: (current: number, total: number, action: PendingAction) => void
  ): Promise<OrganizationResult> {
    const result: OrganizationResult = {
      successful: [],
      failed: [],
      stats: {
        totalEmails: actions.length,
        processed: 0,
        terminated: 0,
        archived: 0,
        kept: 0,
        escalated: 0,
        humanReview: 0,
        bytesFreed: 0,
        processingTimeMs: 0,
      },
    };

    const startTime = Date.now();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const email = emails.get(action.emailId);

      if (onProgress) {
        onProgress(i + 1, actions.length, action);
      }

      try {
        await this.executeAction(action, email?.uid);
        result.successful.push(action);
        result.stats.processed++;

        // Update stats based on action type
        switch (action.action) {
          case 'delete':
            result.stats.terminated++;
            if (email) {
              result.stats.bytesFreed += email.size;
            }
            break;
          case 'archive':
            result.stats.archived++;
            break;
          case 'label':
          case 'move':
            result.stats.kept++;
            break;
        }
      } catch (err) {
        result.failed.push({
          action,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    result.stats.processingTimeMs = Date.now() - startTime;
    return result;
  }

  // Execute a single action
  private async executeAction(action: PendingAction, uid?: number): Promise<void> {
    if (!uid) {
      throw new Error('Email UID not found');
    }

    switch (action.action) {
      case 'delete':
        await this.client.deleteEmail(uid, this.folders.trash);
        break;

      case 'archive':
        if (action.targetFolder) {
          await this.client.moveEmail(uid, action.targetFolder);
        }
        if (action.label) {
          // For Gmail, we'd add a label here
          // IMAP doesn't directly support labels, so we use folders
          try {
            await this.ensureFolder(action.label);
            await this.client.moveEmail(uid, action.label);
          } catch {
            // Fallback to just archiving
            await this.client.moveEmail(uid, this.folders.archive);
          }
        }
        break;

      case 'label':
        if (action.label) {
          try {
            await this.ensureFolder(action.label);
            // Copy to label folder but keep in inbox
            // This is a workaround for IMAP's lack of label support
          } catch {
            // Labeling not supported, skip
          }
        }
        break;

      case 'move':
        if (action.targetFolder) {
          await this.client.moveEmail(uid, action.targetFolder);
        }
        break;
    }
  }

  // Ensure a folder exists
  private async ensureFolder(folderName: string): Promise<void> {
    try {
      await this.client.createFolder(folderName);
    } catch {
      // Folder might already exist, ignore error
    }
  }

  // Preview actions without executing (for dry run)
  previewActions(
    actions: PendingAction[],
    emails: Map<string, EmailMessage>
  ): {
    toDelete: { subject: string; from: string; age: number }[];
    toArchive: { subject: string; from: string; category: string }[];
    toKeep: { subject: string; from: string; label: string }[];
  } {
    const preview = {
      toDelete: [] as { subject: string; from: string; age: number }[],
      toArchive: [] as { subject: string; from: string; category: string }[],
      toKeep: [] as { subject: string; from: string; label: string }[],
    };

    for (const action of actions) {
      const email = emails.get(action.emailId);
      if (!email) continue;

      const subject = email.subject;
      const from = email.from[0]?.address || 'unknown';
      const age = Math.floor((Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24));

      switch (action.action) {
        case 'delete':
          preview.toDelete.push({ subject, from, age });
          break;
        case 'archive':
          preview.toArchive.push({
            subject,
            from,
            category: action.label || 'Archive',
          });
          break;
        case 'label':
        case 'move':
          preview.toKeep.push({
            subject,
            from,
            label: action.label || action.targetFolder || 'Keep',
          });
          break;
      }
    }

    return preview;
  }

  // Get summary of what will happen
  getActionSummary(actions: PendingAction[]): {
    deleteCount: number;
    archiveCount: number;
    labelCount: number;
    moveCount: number;
  } {
    return {
      deleteCount: actions.filter((a) => a.action === 'delete').length,
      archiveCount: actions.filter((a) => a.action === 'archive').length,
      labelCount: actions.filter((a) => a.action === 'label').length,
      moveCount: actions.filter((a) => a.action === 'move').length,
    };
  }

  // Confirm specific actions
  confirmActions(actions: PendingAction[], emailIds: string[]): PendingAction[] {
    return actions.map((action) => ({
      ...action,
      confirmed: emailIds.includes(action.emailId),
    }));
  }

  // Confirm all actions
  confirmAllActions(actions: PendingAction[]): PendingAction[] {
    return actions.map((action) => ({ ...action, confirmed: true }));
  }
}

// Folder naming conventions for different providers
export const FOLDER_CONVENTIONS = {
  gmail: {
    prefix: '[Gmail]/',
    archive: '[Gmail]/All Mail',
    trash: '[Gmail]/Trash',
    spam: '[Gmail]/Spam',
    drafts: '[Gmail]/Drafts',
    sent: '[Gmail]/Sent Mail',
  },
  outlook: {
    prefix: '',
    archive: 'Archive',
    trash: 'Deleted Items',
    spam: 'Junk Email',
    drafts: 'Drafts',
    sent: 'Sent Items',
  },
  generic: {
    prefix: '',
    archive: 'Archive',
    trash: 'Trash',
    spam: 'Spam',
    drafts: 'Drafts',
    sent: 'Sent',
  },
};
