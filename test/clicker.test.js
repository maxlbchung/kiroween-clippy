import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buy,
	CLICK_CLIPS,
	catchUp,
	claimMilestones,
	click,
	costOf,
	FIRST_MILESTONE,
	formatCount,
	formatRate,
	maxAffordable,
	milestoneAt,
	milestoneCredits,
	newFactory,
	OFFLINE_CAP,
	PRODUCERS,
	parseSave,
	produce,
	rateOf,
	unlocked,
} from "../src/renderer/games/clicker/economy.ts";

const [laborer, machine] = PRODUCERS;

test("producers have unique ids and get pricier and faster down the list", () => {
	const ids = PRODUCERS.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length);
	for (let i = 1; i < PRODUCERS.length; i++) {
		assert.ok(PRODUCERS[i].cost > PRODUCERS[i - 1].cost);
		assert.ok(PRODUCERS[i].rate > PRODUCERS[i - 1].rate);
	}
	for (const p of PRODUCERS) assert.ok(p.cost > 0 && p.rate > 0);
});

test("the first producer is for sale from the start", () => {
	assert.ok(unlocked(newFactory(), PRODUCERS[0]));
	assert.ok(!unlocked(newFactory(), machine));
});

test("prices start at the base cost and rise with each one owned", () => {
	assert.equal(costOf(laborer, 0), laborer.cost);
	for (let owned = 0; owned < 50; owned++)
		assert.ok(costOf(laborer, owned + 1) >= costOf(laborer, owned));
	assert.equal(costOf(laborer, 3, 0), 0);
});

test("buying in bulk costs about the same as buying one at a time", () => {
	let separate = 0;
	for (let owned = 5; owned < 15; owned++) separate += costOf(machine, owned);
	const bulk = costOf(machine, 5, 10);
	assert.ok(Math.abs(bulk - separate) <= 10, `${bulk} vs ${separate}`);
});

test("max affordable is the most the clips on hand can buy", () => {
	for (const clips of [0, 14, 15, 100, 1234, 99999]) {
		const f = { ...newFactory(), clips, owned: { laborer: 7 } };
		const n = maxAffordable(f, laborer);
		assert.ok(costOf(laborer, 7, n) <= clips);
		assert.ok(costOf(laborer, 7, n + 1) > clips);
	}
});

test("buying spends clips and adds producers, and refuses when short", () => {
	const f = { ...newFactory(), clips: 20 };
	assert.ok(buy(f, laborer));
	assert.equal(f.clips, 20 - laborer.cost);
	assert.equal(f.owned.laborer, 1);
	assert.ok(!buy(f, laborer));
	assert.equal(f.owned.laborer, 1);
	assert.ok(!buy(f, laborer, 0));
});

test("clicks and producers both count toward lifetime clips", () => {
	const f = newFactory();
	click(f);
	assert.equal(f.clips, CLICK_CLIPS);
	assert.equal(f.clicks, 1);
	f.owned = { laborer: 2, machine: 1 };
	assert.equal(rateOf(f), 2 * laborer.rate + machine.rate);
	const made = produce(f, 10);
	assert.equal(made, rateOf(f) * 10);
	assert.equal(f.total, CLICK_CLIPS + made);
	f.clips = 0;
	assert.equal(f.total, CLICK_CLIPS + made);
});

test("each milestone is claimed once, in order", () => {
	assert.equal(milestoneAt(0), FIRST_MILESTONE);
	assert.equal(milestoneAt(2), FIRST_MILESTONE * 100);
	assert.ok(milestoneCredits(1) > milestoneCredits(0));
	const f = { ...newFactory(), total: milestoneAt(1) + 5 };
	assert.deepEqual(claimMilestones(f), [0, 1]);
	assert.deepEqual(claimMilestones(f), []);
	f.total = milestoneAt(2);
	assert.deepEqual(claimMilestones(f), [2]);
});

test("time away is caught up on, up to a cap", () => {
	const f = { ...newFactory(0), owned: { laborer: 4 } };
	const short = catchUp(f, 60_000);
	assert.equal(short.away, 60);
	assert.equal(short.made, 60 * 4 * laborer.rate);
	assert.equal(f.savedAt, 60_000);
	const long = catchUp(f, 60_000 + 10 * OFFLINE_CAP * 1000);
	assert.equal(long.away, OFFLINE_CAP);
	assert.equal(catchUp(f, 0).made, 0);
});

test("saves round-trip and junk is dropped", () => {
	const f = {
		...newFactory(5),
		clips: 12.5,
		total: 900,
		clicks: 40,
		owned: { laborer: 3 },
		milestones: 2,
	};
	assert.deepEqual(parseSave(JSON.stringify(f)), f);
	assert.equal(parseSave(null), null);
	assert.equal(parseSave("{nope"), null);
	assert.equal(parseSave("42"), null);
	const junk = parseSave(
		JSON.stringify({
			clips: "lots",
			total: -5,
			clicks: Number.POSITIVE_INFINITY,
			owned: { laborer: 2.7, robot: 9, machine: -1 },
			milestones: null,
		}),
	);
	assert.deepEqual(junk, {
		clips: 0,
		total: 0,
		clicks: 0,
		owned: { laborer: 2 },
		milestones: 0,
		savedAt: 0,
	});
	assert.equal(parseSave(JSON.stringify({ clips: 50, total: 10 })).total, 50);
});

test("big counts use short names", () => {
	assert.equal(formatCount(0), "0");
	assert.equal(formatCount(1234.9), "1,234");
	assert.equal(formatCount(999_999), "999,999");
	assert.equal(formatCount(1_250_000), "1.25 million");
	assert.equal(formatCount(3_000_000_000), "3.00 billion");
	assert.equal(formatRate(2.25), "2.3");
	assert.equal(formatRate(1500), "1,500");
});
