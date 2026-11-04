// AI Trivia rules: picking a round, shuffling answers and scoring. Pure, with
// no DOM access, so the game page and the unit tests share it.

export type Topic = "history" | "concepts" | "scifi" | "clippy";

export type Question = {
	/** Stable, unique id. */
	id: string;
	topic: Topic;
	/** The question as Clippy asks it. */
	q: string;
	options: [string, string, string, string];
	/** Index of the right option in `options`. */
	answer: 0 | 1 | 2 | 3;
	/** Shown after the question is answered. */
	fact: string;
};

/** Returns a number in [0, 1), like `Math.random`. */
export type Random = () => number;

/** Questions per round. */
export const ROUND_SIZE = 10;
/** Seconds to answer each question. */
export const TIME_LIMIT = 15;

/** Points for a right answer. Wrong answers and timeouts score nothing. */
export const POINTS = {
	correct: 100,
	/** Speed bonus for answering instantly, falling to 0 as time runs out. */
	speedMax: 50,
	/** Added per right answer in a row after the first. */
	streakStep: 10,
	streakMax: 50,
} as const;

export const TOPIC_LABELS: Record<Topic, string> = {
	history: "AI history",
	concepts: "How AI works",
	scifi: "Robots & sci-fi",
	clippy: "Clippy lore",
};

/** Returns a shuffled copy of `items`. */
export function shuffle<T>(items: readonly T[], random: Random = Math.random) {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Picks `size` distinct questions from `bank`, or the whole bank if it is smaller. */
export function pickRound(
	bank: readonly Question[],
	size = ROUND_SIZE,
	random: Random = Math.random,
) {
	return shuffle(bank, random).slice(0, size);
}

/** Returns a copy of `question` with its options shuffled and `answer` updated to match. */
export function shuffleOptions(
	question: Question,
	random: Random = Math.random,
): Question {
	const order = shuffle([0, 1, 2, 3] as const, random);
	return {
		...question,
		options: order.map((i) => question.options[i]) as Question["options"],
		answer: order.indexOf(question.answer) as Question["answer"],
	};
}

/** Builds a round: distinct questions, each with shuffled options. */
export function newRound(
	bank: readonly Question[],
	size = ROUND_SIZE,
	random: Random = Math.random,
) {
	return pickRound(bank, size, random).map((q) => shuffleOptions(q, random));
}

/** The 50:50 lifeline: indices of two wrong options to remove, in ascending order. */
export function fiftyFifty(question: Question, random: Random = Math.random) {
	const wrong = [0, 1, 2, 3].filter((i) => i !== question.answer);
	return shuffle(wrong, random)
		.slice(0, 2)
		.sort((a, b) => a - b);
}

export type Award = {
	base: number;
	speed: number;
	streak: number;
	total: number;
};

/**
 * Points for one answer. `timeLeft` is in seconds and clamped to
 * [0, TIME_LIMIT]; the speed bonus is rounded to a multiple of 5. `streak`
 * counts right answers in a row including this one.
 */
export function scoreAnswer(
	correct: boolean,
	timeLeft: number,
	streak: number,
): Award {
	if (!correct) return { base: 0, speed: 0, streak: 0, total: 0 };
	const k = Math.max(0, Math.min(1, (Number(timeLeft) || 0) / TIME_LIMIT));
	const base = POINTS.correct;
	const speed = 5 * Math.round((POINTS.speedMax / 5) * k);
	const bonus = Math.min(
		POINTS.streakMax,
		POINTS.streakStep * Math.max(0, streak - 1),
	);
	return { base, speed, streak: bonus, total: base + speed + bonus };
}

/** Running totals for a round. */
export type Tally = {
	score: number;
	answered: number;
	correct: number;
	/** Right answers in a row, reset by a wrong answer or a timeout. */
	streak: number;
	bestStreak: number;
};

export function newTally(): Tally {
	return { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
}

/** Scores one answer. Returns the updated totals without changing `tally`. */
export function recordAnswer(
	tally: Tally,
	correct: boolean,
	timeLeft: number,
): { tally: Tally; award: Award } {
	const streak = correct ? tally.streak + 1 : 0;
	const award = scoreAnswer(correct, timeLeft, streak);
	return {
		award,
		tally: {
			score: tally.score + award.total,
			answered: tally.answered + 1,
			correct: tally.correct + (correct ? 1 : 0),
			streak,
			bestStreak: Math.max(tally.bestStreak, streak),
		},
	};
}
