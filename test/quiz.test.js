import assert from "node:assert/strict";
import { test } from "node:test";
import { QUESTIONS } from "../dist/renderer/games/quiz/questions.js";
import {
	fiftyFifty,
	newRound,
	newTally,
	POINTS,
	pickRound,
	ROUND_SIZE,
	recordAnswer,
	scoreAnswer,
	shuffleOptions,
	TIME_LIMIT,
	TOPIC_LABELS,
} from "../dist/renderer/games/quiz/trivia.js";

/** Deterministic stand-in for Math.random. */
function seeded(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

test("the bank has enough questions for varied rounds", () => {
	assert.ok(QUESTIONS.length >= 4 * ROUND_SIZE);
});

test("question ids are unique", () => {
	const ids = QUESTIONS.map((q) => q.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("every question has four distinct options and a valid answer", () => {
	for (const q of QUESTIONS) {
		assert.equal(q.options.length, 4, q.id);
		const seen = new Set(q.options.map((o) => o.trim().toLowerCase()));
		assert.equal(seen.size, 4, `${q.id} repeats an option`);
		assert.ok(
			q.options.every((o) => o.trim().length > 0),
			q.id,
		);
		assert.ok([0, 1, 2, 3].includes(q.answer), q.id);
		assert.ok(q.q.trim().length > 0 && q.fact.trim().length > 0, q.id);
		assert.ok(q.topic in TOPIC_LABELS, `${q.id} has an unknown topic`);
	}
});

test("a round has the right size and no repeats", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const round = newRound(QUESTIONS, ROUND_SIZE, seeded(seed));
		assert.equal(round.length, ROUND_SIZE);
		assert.equal(new Set(round.map((q) => q.id)).size, ROUND_SIZE);
	}
});

test("rounds vary", () => {
	const a = pickRound(QUESTIONS, ROUND_SIZE, seeded(1)).map((q) => q.id);
	const b = pickRound(QUESTIONS, ROUND_SIZE, seeded(2)).map((q) => q.id);
	assert.notDeepEqual(a, b);
});

test("a small bank yields every question once", () => {
	const round = pickRound(QUESTIONS.slice(0, 3), ROUND_SIZE, seeded(3));
	assert.equal(round.length, 3);
	assert.equal(new Set(round.map((q) => q.id)).size, 3);
});

test("shuffling options keeps the right answer", () => {
	for (const q of QUESTIONS) {
		const asked = shuffleOptions(q, seeded(q.id.length));
		assert.equal(asked.options[asked.answer], q.options[q.answer], q.id);
		assert.deepEqual([...asked.options].sort(), [...q.options].sort(), q.id);
	}
	assert.equal(QUESTIONS[0].options.length, 4, "the bank is not mutated");
});

test("50:50 removes two wrong options", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const q = shuffleOptions(QUESTIONS[seed], seeded(seed));
		const removed = fiftyFifty(q, seeded(seed * 7));
		assert.equal(removed.length, 2);
		assert.equal(new Set(removed).size, 2);
		assert.ok(!removed.includes(q.answer));
		assert.ok(removed.every((i) => i >= 0 && i < 4));
	}
});

test("wrong answers and timeouts score nothing", () => {
	assert.equal(scoreAnswer(false, TIME_LIMIT, 5).total, 0);
	assert.equal(scoreAnswer(false, 0, 0).total, 0);
});

test("right answers earn base points plus a speed bonus", () => {
	const instant = scoreAnswer(true, TIME_LIMIT, 1);
	assert.deepEqual(instant, {
		base: POINTS.correct,
		speed: POINTS.speedMax,
		streak: 0,
		total: POINTS.correct + POINTS.speedMax,
	});
	assert.equal(scoreAnswer(true, 0, 1).total, POINTS.correct);
	assert.equal(scoreAnswer(true, -3, 1).speed, 0);
	assert.equal(scoreAnswer(true, TIME_LIMIT * 2, 1).speed, POINTS.speedMax);
	const half = scoreAnswer(true, TIME_LIMIT / 2, 1).speed;
	assert.ok(half > 0 && half < POINTS.speedMax && half % 5 === 0);
});

test("streak bonus grows per answer in a row and is capped", () => {
	assert.equal(scoreAnswer(true, 0, 1).streak, 0);
	assert.equal(scoreAnswer(true, 0, 2).streak, POINTS.streakStep);
	assert.equal(scoreAnswer(true, 0, 3).streak, 2 * POINTS.streakStep);
	assert.equal(scoreAnswer(true, 0, 100).streak, POINTS.streakMax);
});

test("the tally tracks score, correct answers and the best streak", () => {
	let tally = newTally();
	for (const correct of [true, true, true, false, true]) {
		tally = recordAnswer(tally, correct, 0).tally;
	}
	assert.equal(tally.answered, 5);
	assert.equal(tally.correct, 4);
	assert.equal(tally.streak, 1);
	assert.equal(tally.bestStreak, 3);
	assert.equal(tally.score, 4 * POINTS.correct + 3 * POINTS.streakStep);
});

test("recording an answer leaves the old tally unchanged", () => {
	const before = newTally();
	const { tally, award } = recordAnswer(before, true, TIME_LIMIT);
	assert.deepEqual(before, newTally());
	assert.equal(tally.score, award.total);
});

test("a strong round pays out like a solid Dodge round", () => {
	// Seven right answers, mostly in a row, with time to spare.
	let tally = newTally();
	for (const correct of [true, true, true, true, false, true, true, true]) {
		tally = recordAnswer(tally, correct, TIME_LIMIT / 2).tally;
	}
	assert.ok(tally.score >= 600 && tally.score <= 1200, String(tally.score));
});
