// ============================================================================
//  SRS Scheduler — pure, deterministic, framework-agnostic
// ============================================================================

// ── Types ──────────────────────────────────────────────────
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export type CardPhase = 'new' | 'learning' | 'review';

export interface SRSState {
  interval: number;          // days until next review
  consecutiveCorrect: number;
  easeFactor: number;        // EF, minimum clamped by MIN_EASE_FACTOR
  phase: CardPhase;
  lastReviewed: Date | null;
  nextReview: Date | null;
}

// ── Constants ──────────────────────────────────────────────
export const MIN_EASE_FACTOR = 1.3;
export const MAX_INTERVAL_DAYS = 365 * 3;   // 3 years max

// ── Date helpers ───────────────────────────────────────────
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ── Interval helpers ───────────────────────────────────────
export function clampInterval(raw: number): number {
  return Math.max(0, Math.min(Math.round(raw), MAX_INTERVAL_DAYS));
}

// ── Ease factor helpers ────────────────────────────────────
export function decreaseEF(ef: number, delta: number): number {
  return Math.max(ef - delta, MIN_EASE_FACTOR);
}

export function increaseEF(ef: number, delta: number): number {
  return ef + delta;
}

// ── NEW card grade handlers ────────────────────────────────
function newAgain(_state: SRSState): Pick<SRSState, 'interval' | 'consecutiveCorrect'> {
  return { interval: 0, consecutiveCorrect: 0 };
}

function newHard(_state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: 0.5 };
}

function newGood(_state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: 1 };
}

function newEasy(_state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: 4 };
}

// ── Learning / Review grade handlers ───────────────────────
function reviewAgain(state: SRSState): Pick<SRSState, 'interval' | 'consecutiveCorrect'> {
  return { interval: 1, consecutiveCorrect: 0 };
}

function reviewHard(state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: state.interval * 1.2 };
}

function reviewGood(state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: state.interval * state.easeFactor };
}

function reviewEasy(state: SRSState): Pick<SRSState, 'interval'> {
  return { interval: state.interval * state.easeFactor * 1.3 };
}

// ── EF adjustments per grade ───────────────────────────────
const EF_ADJUST: Record<ReviewGrade, { new: number; review: number }> = {
  again: { new: -0.20, review: -0.20 },
  hard:  { new:  0,    review: -0.15 },
  good:  { new:  0,    review:  0    },
  easy:  { new:  0,    review: +0.15 },
};

// ── Consecutive correct update ─────────────────────────────
function nextConsecutiveCorrect(
  current: number,
  grade: ReviewGrade,
): number {
  return grade === 'again' ? 0 : current + 1;
}

// ── Phase transition ───────────────────────────────────────
function nextPhase(current: CardPhase, grade: ReviewGrade): CardPhase {
  if (current === 'new') return 'learning';
  if (current === 'learning' && grade === 'easy') return 'review';
  if (current === 'review' && grade === 'again') return 'learning';
  return current;
}

// ── Main scheduler ─────────────────────────────────────────
export function schedule(
  state: SRSState,
  grade: ReviewGrade,
  now: Date,
): SRSState {
  const isNew = state.phase === 'new';

  // ── Compute interval ───────────────────────────────────
  let interval: number;
  if (isNew) {
    switch (grade) {
      case 'again': interval = newAgain(state).interval; break;
      case 'hard':  interval = newHard(state).interval;  break;
      case 'good':  interval = newGood(state).interval;  break;
      case 'easy':  interval = newEasy(state).interval;  break;
    }
  } else {
    switch (grade) {
      case 'again': interval = reviewAgain(state).interval; break;
      case 'hard':  interval = reviewHard(state).interval;  break;
      case 'good':  interval = reviewGood(state).interval;  break;
      case 'easy':  interval = reviewEasy(state).interval;  break;
    }
  }

  // ── Compute ease factor ────────────────────────────────
  const efDelta = EF_ADJUST[grade][isNew ? 'new' : 'review'];
  const easeFactor = efDelta < 0
    ? decreaseEF(state.easeFactor, Math.abs(efDelta))
    : efDelta > 0
      ? increaseEF(state.easeFactor, efDelta)
      : state.easeFactor;

  // ── Compute consecutive correct ────────────────────────
  const consecutiveCorrect = isNew && grade === 'again'
    ? 0
    : nextConsecutiveCorrect(state.consecutiveCorrect, grade);

  // ── Final interval ─────────────────────────────────────
  const clamped = clampInterval(interval);

  return {
    interval:      clamped,
    consecutiveCorrect,
    easeFactor,
    phase:         nextPhase(state.phase, grade),
    lastReviewed:  now,
    nextReview:    clamped === 0 ? null : addDays(now, clamped),
  };
}
