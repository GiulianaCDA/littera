# Littera — Product Context

## Overview

**Littera** is an elegant, minimal spaced-repetition system (SRS) for studying English through Roman letters and classical texts.

**User:** Solo language learner studying English via translation of Roman letters
**Goal:** Build active English vocabulary and grammar understanding through authentic classical texts
**Constraint:** Zero JavaScript dependencies, vanilla HTML/CSS/JS, self-contained (SQLite)

---

## Core Features

### 1. Study (Estudar)
- Review cards due today using spaced repetition algorithm
- See word front (English) → reveal back (Portuguese translation)
- Grade difficulty: 1 (failed) to 4 (easy)
- Auto-schedule next review based on SM-2 algorithm
- Keyboard shortcuts: space/enter (reveal), 1-4 (grade), P (pronounce)

### 2. Practice (Praticar)
- Write sentences using target expressions
- AI evaluation (via OpenRouter) for grammar & naturalness
- Feedback: correctness, complexity level, suggested correction
- Cycle through random cards, unlimited repetitions

### 3. Cards (Cartões)
- Browse all cards (full deck)
- Search by word, meaning, or category
- Delete cards
- View phonetic transcription (IPA) and pronunciation
- Fetch IPA automatically from dictionary API

### 4. Add (Adicionar)
- Add single cards: English | Portuguese | Example | Category
- Bulk import: paste lines, auto-parse
- Optional IPA field
- Auto-fetch pronunciation if empty

---

## Technical Stack

- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)
- **Backend:** Node.js (server.mjs)
- **Database:** SQLite + WAL mode (data.db)
- **AI:** OpenRouter API (free tier or paid models)
- **Deployment:** Render, Railway, or self-hosted
- **No build step:** Files served directly

---

## User Motivation

The user studies English through **translations of ancient Roman letters** to:
- Expand vocabulary in context (not isolated words)
- Learn natural, sophisticated English expressions
- Understand grammar through real examples
- Build active vocabulary gradually
- Study a subject with literary/historical depth

**Not** a casual language app — user is committed, wants intellectual depth.

---

## Design Values

1. **Elegance over fun:** Refined, literary feel (not gamified)
2. **Authenticity over templates:** Specific to classical education
3. **Clarity over features:** What's needed, nothing more
4. **Dark mode default:** Reduce eye strain during study
5. **Keyboard-first:** Fast workflow for serious learners

---

## Usage Patterns

**Daily routine:**
1. Open app → Study tab (10-30 min)
2. Review cards due (often 5-20 cards)
3. Grade each card based on recall difficulty
4. Check streak, see progress badges
5. Add new cards if studying fresh material

**Weekly:**
- Bulk import new Roman letter translated vocab
- Review progress stats
- Fine-tune study categories

**Monthly:**
- Review historical progress
- Identify vocabulary gaps
- Adjust study focus

---

## Data Model

### Cards Table
```
id, front, back, example, tag, ipa, audio, 
ease, interval, reps, lapses, due, created
```

**State per card:**
- `ease`: Difficulty multiplier (SM-2, default 2.5)
- `interval`: Days until next review
- `reps`: Number of successful reviews
- `lapses`: Number of failures
- `due`: Unix timestamp of next review

### Reviews Table
```
id, card_id, grade, ts
```

**Tracks:** Every grade (0-3) with timestamp for statistics

---

## Analytics & Stats

- **Total:** All cards in deck
- **Fresh:** Never reviewed (reps = 0)
- **Learning:** Reviewed but interval < 21 days
- **Mature:** Interval >= 21 days (consolidated)
- **Due:** Cards due now (due <= now)
- **Today:** Reviews completed today
- **Streak:** Consecutive days with at least one review
- **Accuracy:** % of grades > 0 (overall success rate)

---

## Constraints & Decisions

### Why SQLite, not PostgreSQL?
- **For MVP:** Single user, no concurrency needed
- **Simpler deployment:** File-based, no server dependency
- **Zero DevOps:** No DB credentials, backups, migrations
- **Trade-off:** Not suitable for 100+ concurrent users

**Migration path:** Switch to PostgreSQL when needed (code change only)

### Why OpenRouter for AI evaluation?
- **Free tier available:** No upfront cost
- **Model agnostic:** Can swap models (free → Claude → GPT)
- **Retry logic:** Handles free tier model switching
- **Alternative:** Self-host with Ollama (if GPU available)

### Why dark mode default?
- **Fatigue:** Study sessions are long, dark reduces eye strain
- **Authentic:** Classical texts often rendered on dark backgrounds
- **No light mode (yet):** Reduce complexity, revisit if requested

---

## Future Considerations

- **Light mode:** Community request only
- **Themes:** Token swapping system (already designed)
- **Export:** Anki deck export (compatibility)
- **Progress charts:** Activity heatmap, velocity graph
- **Offline mode:** Service worker caching
- **Mobile app:** React Native wrapper (future)
- **Collaborative:** Multi-user study groups
- **Text analysis:** Highlight vocabulary from uploaded text

---

## Success Metrics

- **Engagement:** DAU (daily active users), average session length
- **Learning:** % of cards matured, accuracy trend
- **Retention:** Streak length, cards reviewed per week
- **Satisfaction:** User feedback, feature requests

**Current focus:** Solo user validation, learning algorithm correctness

---

## Handoff Notes

This document captures product intent and constraints. Design decisions are in DESIGN.md (visual system, component specs, breakpoints). Implementation details are in code comments and git history.

**Key files:**
- `public/index.html` — UI markup
- `public/style.css` — Design system, responsive layout
- `public/app.js` — Client-side logic
- `server.mjs` — API endpoints, AI integration
- `db.mjs` — Database schema, migrations
- `srs.mjs` — SM-2 scheduling algorithm
