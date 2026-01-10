# ⚡ KILL ALL EMAIL

```
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
```

> *"I'll be back... for your spam"*

**Inbox Termination System** - An AI-powered email management tool with a retro 80s terminal aesthetic inspired by the Terminator. Uses Claude AI to intelligently categorize, organize, and clean up your inbox.

## Features

- **AI-Powered Categorization**: Uses Claude to intelligently categorize emails
- **Smart Escalation**: Uncertain emails are escalated to smarter models for better accuracy
- **Multi-Tier Organization**: Archives (receipts, personal, work, legal, travel, newsletters), keeps, and terminates
- **Retro Terminal UI**: 80s-inspired visuals with scanlines, glitch effects, and vector graphics
- **Tunable "Knobs"**: Configure aggressiveness, confidence thresholds, and more
- **Presets**: Conservative, Balanced, Aggressive, and TERMINATOR modes
- **Safety First**: Dry-run mode by default, confirmation required for deletions
- **Human Review**: Escalates ambiguous emails with AI-generated questions

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/kill-all-email.git
cd kill-all-email

# Install dependencies
npm install

# Build
npm run build

# Run
npm start
```

## Quick Start

```bash
# Start interactive mode
npm start

# Or use the CLI directly
node dist/index.js
```

## Configuration

### Email Setup

Supports Gmail, Outlook, Yahoo, and custom IMAP servers.

**For Gmail:**
1. Enable 2-Factor Authentication
2. Generate an App Password at [myaccount.google.com](https://myaccount.google.com)
3. Use your email and app password in the setup

### API Key

Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Environment Variables

```bash
export ANTHROPIC_API_KEY="sk-..."
export KILL_EMAIL_THEME="terminator"  # or: matrix, amber, green
```

## Categories

### Termination Targets (Delete)
- `TERMINATE` - Delete immediately (spam, expired offers, junk)
- `TERMINATE_DELAYED` - Delete after review period

### Archive Categories
- `ARCHIVE_RECEIPTS` - Purchase confirmations, invoices
- `ARCHIVE_PERSONAL` - Personal correspondence
- `ARCHIVE_WORK` - Professional emails
- `ARCHIVE_LEGAL` - Legal, tax, financial documents
- `ARCHIVE_TRAVEL` - Travel confirmations, itineraries
- `ARCHIVE_NEWSLETTERS` - Newsletters worth keeping

### Keep Categories
- `KEEP_ACTION` - Needs response or action
- `KEEP_REFERENCE` - Reference material
- `KEEP_IMPORTANT` - Important, do not touch

### Escalation
- `ESCALATE` - Needs smarter AI analysis
- `HUMAN_REVIEW` - Requires human decision

## Presets

| Preset | Description | Aggressiveness |
|--------|-------------|----------------|
| Conservative | Very careful, only deletes obvious spam | 2/10 |
| Balanced | Good mix of cleanup and safety | 5/10 |
| Aggressive | Fast cleanup, more deletion | 8/10 |
| TERMINATOR | Maximum deletion, no mercy | 10/10 |

## Smart Knobs

- **Aggressiveness (1-10)**: How aggressive to be with deletions
- **Delete Confidence (0-1)**: Minimum confidence to auto-delete
- **Escalation Threshold (0-1)**: When to escalate to smarter model
- **Recent Email Protection**: Protect emails newer than X days
- **Attachment Escalation**: Escalate emails with attachments

## Themes

- **terminator**: Red and black, Terminator-inspired
- **matrix**: Green on black, Matrix-style
- **amber**: Classic amber monochrome
- **green**: Classic green monochrome

## Safety Features

1. **Dry Run by Default**: Preview changes before executing
2. **Confirmation Required**: Must confirm before bulk deletions
3. **Escalation**: Uncertain emails go to smarter model
4. **Human Review**: Truly ambiguous cases are flagged for manual review
5. **Protected Patterns**: Legal, tax, and important terms trigger human review
6. **Trusted/Blocked Domains**: Configure sender trust levels

## CLI Options

```bash
kill-email              # Start interactive mode
kill-email --help       # Show help
kill-email --version    # Show version
kill-email --reset      # Reset configuration
kill-email --dry-run    # Force preview mode
kill-email --aggressive # Use aggressive preset
kill-email --folder INBOX  # Scan specific folder
kill-email --limit 100  # Limit emails to process
```

## Architecture

```
src/
├── index.ts          # Main entry point
├── engine.ts         # Processing pipeline
├── types.ts          # Type definitions
├── config/
│   ├── defaults.ts   # Default configurations
│   └── manager.ts    # Configuration management
├── email/
│   ├── imap-client.ts    # IMAP connection
│   └── organizer.ts      # Email organization
├── llm/
│   └── categorizer.ts    # AI categorization
└── ui/
    ├── theme.ts      # Visual themes
    ├── effects.ts    # Visual effects
    ├── renderer.ts   # Terminal rendering
    └── prompts.ts    # Interactive prompts
```

## License

MIT

---

*"Hasta la vista, spam."*
