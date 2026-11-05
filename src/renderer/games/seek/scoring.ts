// Hide & Seek scoring rules. Pure, so they run in unit tests.

/** Seconds a round lasts. */
export const TIME_LIMIT = 100;
export const FIND_POINTS = 150;
/** Points per whole second left on the clock, awarded only when every Clippy is found. */
export const TIME_BONUS = 8;
export const MISS_PENALTY = 20;
export const HINT_COST = 100;

export type Tally = {
	found: number;
	misses: number;
	hints: number;
	/** Seconds left on the clock. */
	timeLeft: number;
	won: boolean;
};

/** Final score for a round; never negative. */
export function roundScore(t: Tally) {
	const bonus = t.won ? Math.ceil(Math.max(0, t.timeLeft)) * TIME_BONUS : 0;
	return Math.max(
		0,
		t.found * FIND_POINTS +
			bonus -
			t.misses * MISS_PENALTY -
			t.hints * HINT_COST,
	);
}

/** Heat a stray click may reach before it counts as a miss. */
export const EAGER_LIMIT = 3;
/** Heat lost per second. */
export const EAGER_COOLING = 1;

/**
 * Adds one stray click (a click on empty space or plain content) to `heat`,
 * after cooling it for the `dt` seconds since the previous one. Clicking
 * calmly never misses; a burst of clicks does, and keeps missing while the
 * burst goes on. Returns the new heat and whether this click is a miss.
 */
export function strayClick(heat: number, dt: number) {
	const next = Math.max(0, heat - Math.max(0, dt) * EAGER_COOLING) + 1;
	return {
		heat: Math.min(next, EAGER_LIMIT + 1),
		miss: next > EAGER_LIMIT,
	};
}
