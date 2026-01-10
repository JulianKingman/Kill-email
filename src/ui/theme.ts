/**
 * KILL ALL EMAIL - Theme Configuration
 * "I need your clothes, your boots, and your color scheme"
 */

import chalk from 'chalk';

export interface ThemeColors {
  primary: chalk.Chalk;
  secondary: chalk.Chalk;
  accent: chalk.Chalk;
  danger: chalk.Chalk;
  warning: chalk.Chalk;
  success: chalk.Chalk;
  muted: chalk.Chalk;
  text: chalk.Chalk;
  background: string;
  border: chalk.Chalk;
}

export const THEMES: Record<string, ThemeColors> = {
  terminator: {
    primary: chalk.red,
    secondary: chalk.redBright,
    accent: chalk.yellow,
    danger: chalk.red.bold,
    warning: chalk.yellowBright,
    success: chalk.greenBright,
    muted: chalk.gray,
    text: chalk.white,
    background: 'black',
    border: chalk.red,
  },
  matrix: {
    primary: chalk.green,
    secondary: chalk.greenBright,
    accent: chalk.white,
    danger: chalk.red,
    warning: chalk.yellow,
    success: chalk.greenBright,
    muted: chalk.gray,
    text: chalk.greenBright,
    background: 'black',
    border: chalk.green,
  },
  amber: {
    primary: chalk.hex('#FFB000'),
    secondary: chalk.hex('#FF8C00'),
    accent: chalk.white,
    danger: chalk.red,
    warning: chalk.hex('#FFB000'),
    success: chalk.greenBright,
    muted: chalk.hex('#666600'),
    text: chalk.hex('#FFB000'),
    background: 'black',
    border: chalk.hex('#FFB000'),
  },
  green: {
    primary: chalk.hex('#00FF00'),
    secondary: chalk.hex('#00CC00'),
    accent: chalk.white,
    danger: chalk.red,
    warning: chalk.yellow,
    success: chalk.hex('#00FF00'),
    muted: chalk.hex('#006600'),
    text: chalk.hex('#00FF00'),
    background: 'black',
    border: chalk.hex('#00FF00'),
  },
};

// ASCII Art for different UI elements
export const ASCII_ART = {
  logo: `
██╗  ██╗██╗██╗     ██╗          █████╗ ██╗     ██╗
██║ ██╔╝██║██║     ██║         ██╔══██╗██║     ██║
█████╔╝ ██║██║     ██║         ███████║██║     ██║
██╔═██╗ ██║██║     ██║         ██╔══██║██║     ██║
██║  ██╗██║███████╗███████╗    ██║  ██║███████╗███████╗
╚═╝  ╚═╝╚═╝╚══════╝╚══════╝    ╚═╝  ╚═╝╚══════╝╚══════╝

           ███████╗███╗   ███╗ █████╗ ██╗██╗
           ██╔════╝████╗ ████║██╔══██╗██║██║
           █████╗  ██╔████╔██║███████║██║██║
           ██╔══╝  ██║╚██╔╝██║██╔══██║██║██║
           ███████╗██║ ╚═╝ ██║██║  ██║██║███████╗
           ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
`,

  skull: `
      ___________
     /           \\
    |  *     *   |
    |     ^      |
    |   \\___/    |
     \\_________/
`,

  crosshair: `
       │
    ───┼───
       │
`,

  terminate: `
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ████████╗███████╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗╚══██╔══╝██╔════╝
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║   ██║   █████╗
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║   ██║   ██╔══╝
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║   ██║   ███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
`,

  box: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    teeRight: '╠',
    teeLeft: '╣',
    teeDown: '╦',
    teeUp: '╩',
    cross: '╬',
  },

  loading: ['◐', '◓', '◑', '◒'],
  loadingBars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
  scanProgress: ['░', '▒', '▓', '█'],

  bullets: {
    terminate: '✖',
    archive: '◉',
    keep: '★',
    escalate: '⚡',
    human: '?',
    processing: '◌',
    complete: '●',
  },
};

// Glitch characters for effects
export const GLITCH_CHARS = [
  '░', '▒', '▓', '█', '▄', '▀', '■', '□', '▪', '▫',
  '╔', '╗', '╚', '╝', '═', '║', '╠', '╣', '╦', '╩',
  '¤', '§', '¶', '†', '‡', '◊', '●', '○', '◐', '◑',
];

// Vector-style frame characters
export const VECTOR_FRAME = {
  corner: {
    tl: '┌',
    tr: '┐',
    bl: '└',
    br: '┘',
  },
  line: {
    h: '─',
    v: '│',
  },
  double: {
    corner: { tl: '╔', tr: '╗', bl: '╚', br: '╝' },
    line: { h: '═', v: '║' },
  },
};

// Status indicators
export const STATUS_ICONS = {
  scanning: '◎',
  processing: '◉',
  terminating: '✖',
  archiving: '◈',
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  arrow: '➤',
  bullet: '•',
};
