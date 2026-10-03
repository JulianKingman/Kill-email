# Kill All Email - Architecture Notes

## Overview

Hosted service for AI-powered email cleanup. Users connect their email accounts, and the system intelligently categorizes and deletes unwanted emails.

## Infrastructure

### Required Components

- **Database**: Postgres (users, sessions, processed emails, sender patterns)
- **Queue**: Redis + BullMQ for background processing
- **Auth**: OAuth (Google, Microsoft, Yahoo) - provides email access tokens
- **API**: Express + WebSocket for real-time updates
- **LLM**: OpenRouter for model flexibility

### Environment Configuration

```
OPENROUTER_API_KEY=
TIER2_MODEL=openai/gpt-4o-mini  # Fast, cheap, configurable
TIER3_MODEL=google/gemini-2.5-flash
TIER3_MODEL_PREMIUM=anthropic/claude-opus-4.5  # For laser-guided mode
```

## Email Processing Pipeline

### Three-Tier Funnel

```
Tier 1: METADATA TRIAGE (no LLM, instant)
├── Pattern matching on sender/subject
├── Age-based rules (newsletters > 6mo old)
├── Known spam domains, unsubscribe patterns
├── Output: ~40-60% auto-categorized
│
Tier 2: BATCH SCAN (cheap, fast - GPT-4o-mini via OpenRouter)
├── Process remaining in batches of 20-50
├── Send only: subject, sender, date, snippet
├── Quick kill/keep/unsure decision
├── Output: ~30-40% more categorized
│
Tier 3: DEEP ANALYSIS (Gemini 2.5 Flash / Opus 4.5)
├── Only "unsure" emails from Tier 2
├── Full body analysis
├── Complex decisions (legal, financial, personal)
└── Output: Final decisions + human review queue
```

### Estimated Costs (10k emails)

- Tier 1: $0 (local pattern matching)
- Tier 2: ~$0.50-1.00 (GPT-4o-mini on metadata)
- Tier 3: ~$2-5 (Gemini Flash on ~5-10% of emails)

## Processing Phases

### Phase 1: Inventory

- Fetch all message IDs + metadata (paginated)
- Store in DB with status: `pending`
- Calculate estimated cost
- Show user: "Found 47,382 emails. Est. cost: $3-8"

### Phase 2: Streaming Triage

- Process in micro-batches of 20-50
- Tier 1 → Tier 2 → Tier 3 pipeline per batch
- Stream results to UI via WebSocket
- User can pause/adjust/stop anytime
- Checkpoint after each batch

### Phase 3: Execution

- User reviews summary + samples
- Confirms deletion
- Batch delete via IMAP
- Move to trash (not permanent delete)

## Optional Modes

| Mode | Description | Implementation |
|------|-------------|----------------|
| **Standard** | Conservative, asks when unsure | Default thresholds |
| **With Prejudice** | Aggressive deletion, fewer questions | Lower confidence threshold, auto-delete newsletters/promos |
| **Laser-Guided** | Smarter analysis, better decisions | Opus 4.5 for Tier 3 instead of Gemini Flash |
| **Coordinated Attack** | Organize keepers into folders/labels | Post-processing step to categorize kept emails |

## Open Questions

1. **Batch size**: 20-50 emails per batch for responsiveness
2. **Processing order**: Newest first? Oldest first? Largest first? User choice?
3. **Threading**: Delete whole conversation or individual messages?
4. **Folders**: Start with INBOX only, or all folders?
5. **Attachments**: Factor into decision? (large old attachments = good deletion candidates)
6. **Cross-user learning**: Build global sender reputation? (privacy tradeoff)
7. **Billing model**: Per email scanned? Per tier? Monthly subscription?

## Database Schema (Draft)

```sql
-- Users
users (id, email, oauth_provider, oauth_token, created_at)

-- Email accounts connected by users
email_accounts (id, user_id, provider, email, access_token, refresh_token)

-- Processing sessions
sessions (id, user_id, email_account_id, status, mode, started_at, completed_at)

-- Individual emails being processed
emails (id, session_id, message_id, subject, sender, date, size,
        tier1_decision, tier2_decision, tier3_decision, final_decision,
        processed_at)

-- Learned sender patterns (per-user or global)
sender_patterns (id, sender_domain, sender_email, reputation_score, sample_count)
```

## Tech Stack

- **Frontend**: React + Vite + Zustand
- **Backend**: Node.js + Express + WebSocket
- **Database**: Postgres + Prisma
- **Queue**: Redis + BullMQ
- **Auth**: Passport.js with OAuth strategies
- **LLM**: OpenRouter API
- **Hosting**: TBD (Railway, Render, AWS?)
