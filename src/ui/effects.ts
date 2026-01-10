/**
 * KILL ALL EMAIL - Visual Effects
 * "The future is not set. There's no fate but what we display."
 */

import chalk from 'chalk';
import { THEMES, GLITCH_CHARS, ASCII_ART, ThemeColors } from './theme';

export class VisualEffects {
  private theme: ThemeColors;
  private scanlineOffset = 0;
  private glitchIntensity = 0.1;

  constructor(themeName: string = 'terminator') {
    this.theme = THEMES[themeName] || THEMES.terminator;
  }

  setTheme(themeName: string): void {
    this.theme = THEMES[themeName] || THEMES.terminator;
  }

  // Scanline effect - adds horizontal lines
  applyScanlines(text: string, intensity: number = 0.3): string {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if ((i + this.scanlineOffset) % 3 === 0) {
        return this.theme.muted(line);
      }
      return line;
    }).join('\n');
  }

  // Glitch effect - randomly replace characters
  applyGlitch(text: string, intensity: number = 0.05): string {
    return text.split('').map(char => {
      if (Math.random() < intensity && char !== '\n' && char !== ' ') {
        return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      }
      return char;
    }).join('');
  }

  // CRT flicker effect
  applyFlicker(text: string): string {
    const flickerChance = 0.02;
    if (Math.random() < flickerChance) {
      return this.theme.muted(text);
    }
    return text;
  }

  // Type-writer effect (returns array of strings to display progressively)
  typewriter(text: string): string[] {
    const frames: string[] = [];
    for (let i = 0; i <= text.length; i++) {
      frames.push(text.substring(0, i) + (i < text.length ? '█' : ''));
    }
    return frames;
  }

  // Progress bar with retro styling
  progressBar(current: number, total: number, width: number = 40): string {
    const percentage = total > 0 ? current / total : 0;
    const filled = Math.floor(percentage * width);
    const empty = width - filled;

    const bar = this.theme.primary('█'.repeat(filled)) +
                this.theme.muted('░'.repeat(empty));

    return `[${bar}] ${(percentage * 100).toFixed(1)}%`;
  }

  // Animated loading spinner
  getSpinnerFrame(tick: number): string {
    const frames = ASCII_ART.loading;
    return this.theme.primary(frames[tick % frames.length]);
  }

  // Wave animation for loading bars
  getWaveFrame(tick: number, width: number = 20): string {
    const bars = ASCII_ART.loadingBars;
    let wave = '';
    for (let i = 0; i < width; i++) {
      const index = (tick + i) % bars.length;
      wave += bars[index];
    }
    return this.theme.primary(wave);
  }

  // Matrix rain effect (single frame)
  matrixRain(width: number, height: number): string[] {
    const chars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ01234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lines: string[] = [];

    for (let y = 0; y < height; y++) {
      let line = '';
      for (let x = 0; x < width; x++) {
        if (Math.random() < 0.1) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          if (Math.random() < 0.3) {
            line += chalk.greenBright(char);
          } else {
            line += chalk.green(char);
          }
        } else {
          line += ' ';
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // Box drawing with theme colors
  drawBox(title: string, content: string, width: number = 60): string {
    const b = ASCII_ART.box;
    const innerWidth = width - 2;
    const lines: string[] = [];

    // Top border with title
    const titlePadded = ` ${title} `;
    const titleLen = titlePadded.length;
    const leftPad = Math.floor((innerWidth - titleLen) / 2);
    const rightPad = innerWidth - leftPad - titleLen;

    lines.push(
      this.theme.border(b.topLeft) +
      this.theme.border(b.horizontal.repeat(leftPad)) +
      this.theme.accent(titlePadded) +
      this.theme.border(b.horizontal.repeat(rightPad)) +
      this.theme.border(b.topRight)
    );

    // Content lines
    const contentLines = content.split('\n');
    for (const line of contentLines) {
      const stripped = this.stripAnsi(line);
      const padding = innerWidth - stripped.length;
      lines.push(
        this.theme.border(b.vertical) +
        line +
        ' '.repeat(Math.max(0, padding)) +
        this.theme.border(b.vertical)
      );
    }

    // Bottom border
    lines.push(
      this.theme.border(b.bottomLeft) +
      this.theme.border(b.horizontal.repeat(innerWidth)) +
      this.theme.border(b.bottomRight)
    );

    return lines.join('\n');
  }

  // Strip ANSI codes for length calculation
  private stripAnsi(str: string): string {
    return str.replace(/\x1B\[[0-9;]*m/g, '');
  }

  // Render logo with theme colors and optional glitch
  renderLogo(glitch: boolean = false): string {
    let logo = ASCII_ART.logo;
    if (glitch) {
      logo = this.applyGlitch(logo, 0.02);
    }
    return this.theme.primary(logo);
  }

  // Status line with icon
  statusLine(icon: string, message: string, detail?: string): string {
    let line = `${this.theme.accent(icon)} ${this.theme.text(message)}`;
    if (detail) {
      line += ` ${this.theme.muted(`[${detail}]`)}`;
    }
    return line;
  }

  // Email fate visualization
  fateIcon(fate: string): string {
    const icons: Record<string, { icon: string; color: chalk.Chalk }> = {
      TERMINATE: { icon: '✖', color: this.theme.danger },
      TERMINATE_DELAYED: { icon: '⏱', color: this.theme.warning },
      ARCHIVE_RECEIPTS: { icon: '🧾', color: this.theme.muted },
      ARCHIVE_PERSONAL: { icon: '👤', color: this.theme.secondary },
      ARCHIVE_WORK: { icon: '💼', color: this.theme.secondary },
      ARCHIVE_LEGAL: { icon: '⚖', color: this.theme.accent },
      ARCHIVE_TRAVEL: { icon: '✈', color: this.theme.secondary },
      ARCHIVE_NEWSLETTERS: { icon: '📰', color: this.theme.muted },
      KEEP_ACTION: { icon: '⚡', color: this.theme.warning },
      KEEP_REFERENCE: { icon: '📌', color: this.theme.secondary },
      KEEP_IMPORTANT: { icon: '★', color: this.theme.accent },
      ESCALATE: { icon: '↑', color: this.theme.warning },
      HUMAN_REVIEW: { icon: '?', color: this.theme.accent },
    };

    const item = icons[fate] || { icon: '•', color: this.theme.text };
    return item.color(item.icon);
  }

  // Animated termination effect
  terminationSequence(): string[] {
    const frames: string[] = [];
    const target = 'TARGET ACQUIRED';
    const terminate = 'TERMINATING...';
    const success = 'TERMINATED ✖';

    // Target acquired
    for (let i = 0; i <= target.length; i++) {
      frames.push(this.theme.warning(target.substring(0, i) + '█'));
    }

    // Terminate
    for (let i = 0; i <= terminate.length; i++) {
      frames.push(this.theme.danger(terminate.substring(0, i) + '█'));
    }

    // Success flash
    frames.push(this.theme.danger.bold(success));
    frames.push(this.theme.primary.bold(success));
    frames.push(this.theme.danger.bold(success));

    return frames;
  }

  // Stats display
  renderStats(stats: {
    terminated: number;
    archived: number;
    kept: number;
    escalated: number;
    bytesFreed: number;
  }): string {
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    };

    const lines = [
      this.theme.danger(`  ✖ TERMINATED: ${stats.terminated}`),
      this.theme.secondary(`  ◉ ARCHIVED:   ${stats.archived}`),
      this.theme.success(`  ★ KEPT:       ${stats.kept}`),
      this.theme.warning(`  ↑ ESCALATED:  ${stats.escalated}`),
      '',
      this.theme.accent(`  💾 FREED: ${formatBytes(stats.bytesFreed)}`),
    ];

    return lines.join('\n');
  }

  // Horizontal divider
  divider(width: number = 60, char: string = '═'): string {
    return this.theme.border(char.repeat(width));
  }

  // Countdown display
  countdown(seconds: number): string {
    const padded = String(seconds).padStart(2, '0');
    return this.theme.danger.bold(`T-${padded}`);
  }
}

// Singleton instance
let effectsInstance: VisualEffects | null = null;

export function getEffects(theme?: string): VisualEffects {
  if (!effectsInstance || theme) {
    effectsInstance = new VisualEffects(theme);
  }
  return effectsInstance;
}
