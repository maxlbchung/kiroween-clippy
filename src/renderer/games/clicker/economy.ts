// Clippy Clicker rules: paperclips, producers that make them, milestone
// rewards, offline progress and the save format. Pure, with no DOM access, so
// the page and the unit tests share it.

export type Producer = {
	/** Stable id, used in saves. */
	id: string;
	name: string;
	plural: string;
	blurb: string;
	/** Price of the first one, in clips. Each one bought raises the next price. */
	cost: number;
	/** Clips each one makes per second. */
	rate: number;
	/** Lifetime clips needed before the shop reveals it. */
	unlockAt: number;
};

/** What the shop sells, cheapest first. Append new producers to expand the game. */
export const PRODUCERS: readonly Producer[] = [
	{
		id: "laborer",
		name: "Laborer",
		plural: "Laborers",
		blurb: "Bends wire into clips by hand.",
		cost: 15,
		rate: 0.5,
		unlockAt: 0,
	},
	{
		id: "machine",
		name: "Clip machine",
		plural: "Clip machines",
		blurb: "Stamps out clips all day long.",
		cost: 150,
		rate: 5,
		unlockAt: 60,
	},
];

/** Each producer bought makes the next one this much more expensive. */
export const PRICE_GROWTH = 1.15;
/** Clips made by one click. */
export const CLICK_CLIPS = 1;
/** Longest stretch of time away that the factory catches up on, in seconds. */
export const OFFLINE_CAP = 2 * 60 * 60;
/** Lifetime clips for the first milestone. Each later one is ten times more. */
export const FIRST_MILESTONE = 100;
/** Credits for the first milestone. Each later one pays this much more. */
export const MILESTONE_CREDITS = 10;

export type Factory = {
	/** Clips on hand. */
	clips: number;
	/** Clips ever made, which spending never lowers. */
	total: number;
	clicks: number;
	/** How many of each producer are owned, by producer id. */
	owned: Record<string, number>;
	/** Milestones already rewarded. */
	milestones: number;
	/** When the factory was last saved, in ms since the epoch. */
	savedAt: number;
};

export function newFactory(now = 0): Factory {
	return {
		clips: 0,
		total: 0,
		clicks: 0,
		owned: {},
		milestones: 0,
		savedAt: now,
	};
}

export const ownedOf = (f: Factory, p: Producer) => f.owned[p.id] ?? 0;

/** Price of the next `count` of `p` when `owned` are already built. */
export function costOf(p: Producer, owned: number, count = 1) {
	if (count <= 0) return 0;
	const first = p.cost * PRICE_GROWTH ** owned;
	return Math.ceil((first * (PRICE_GROWTH ** count - 1)) / (PRICE_GROWTH - 1));
}

/** How many of `p` the factory can afford right now. */
export function maxAffordable(f: Factory, p: Producer) {
	const owned = ownedOf(f, p);
	const first = p.cost * PRICE_GROWTH ** owned;
	const n = Math.floor(
		Math.log((f.clips * (PRICE_GROWTH - 1)) / first + 1) /
			Math.log(PRICE_GROWTH),
	);
	// Rounds the estimate against the exact, rounded-up price.
	let count = Math.max(0, n);
	while (count > 0 && costOf(p, owned, count) > f.clips) count -= 1;
	while (costOf(p, owned, count + 1) <= f.clips) count += 1;
	return count;
}

/** Buys `count` of `p` if the factory can afford them. Returns whether it did. */
export function buy(f: Factory, p: Producer, count = 1) {
	const price = costOf(p, ownedOf(f, p), count);
	if (count <= 0 || price > f.clips) return false;
	f.clips -= price;
	f.owned[p.id] = ownedOf(f, p) + count;
	return true;
}

/** Clips the factory makes per second. */
export function rateOf(f: Factory) {
	return PRODUCERS.reduce((sum, p) => sum + ownedOf(f, p) * p.rate, 0);
}

/** Adds `n` freshly made clips. */
export function make(f: Factory, n: number) {
	f.clips += n;
	f.total += n;
}

export function click(f: Factory) {
	f.clicks += 1;
	make(f, CLICK_CLIPS);
}

/** Runs the producers for `seconds`. Returns the clips they made. */
export function run(f: Factory, seconds: number) {
	const made = rateOf(f) * Math.max(0, seconds);
	make(f, made);
	return made;
}

/** Whether the shop shows `p` yet. */
export const unlocked = (f: Factory, p: Producer) =>
	f.total >= p.unlockAt || ownedOf(f, p) > 0;

/** Lifetime clips needed for milestone `k`, counting from 0. */
export const milestoneAt = (k: number) => FIRST_MILESTONE * 10 ** k;

/** Credits paid for milestone `k`, counting from 0. */
export const milestoneCredits = (k: number) => MILESTONE_CREDITS * (k + 1);

/**
 * Marks every milestone the factory has passed but not been rewarded for,
 * and returns their indexes.
 */
export function claimMilestones(f: Factory) {
	const reached: number[] = [];
	while (f.total >= milestoneAt(f.milestones)) {
		reached.push(f.milestones);
		f.milestones += 1;
	}
	return reached;
}

/**
 * Catches up on production while the game was closed, up to `OFFLINE_CAP`.
 * Returns the clips made and the seconds counted.
 */
export function catchUp(f: Factory, now: number) {
	const away = Math.min(OFFLINE_CAP, Math.max(0, (now - f.savedAt) / 1000));
	const made = run(f, away);
	f.savedAt = now;
	return { made, away };
}

const count = (v: unknown) =>
	typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

/** Reads a save, keeping only valid fields. Returns null for anything else. */
export function parseSave(json: string | null): Factory | null {
	if (!json) return null;
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return null;
	}
	if (!data || typeof data !== "object") return null;
	const d = data as Record<string, unknown>;
	const owned: Record<string, number> = {};
	const rawOwned = d.owned && typeof d.owned === "object" ? d.owned : {};
	for (const p of PRODUCERS) {
		const n = Math.floor(count((rawOwned as Record<string, unknown>)[p.id]));
		if (n) owned[p.id] = n;
	}
	const clips = count(d.clips);
	return {
		clips,
		total: Math.max(clips, count(d.total)),
		clicks: Math.floor(count(d.clicks)),
		owned,
		milestones: Math.floor(count(d.milestones)),
		savedAt: count(d.savedAt),
	};
}

const BIG = [
	"million",
	"billion",
	"trillion",
	"quadrillion",
	"quintillion",
	"sextillion",
];

/** Whole clips with thousands separators, or a short form like "1.25 million". */
export function formatCount(n: number) {
	const v = Math.floor(Math.max(0, n));
	if (v < 1e6) return v.toLocaleString("en-US");
	const tier = Math.min(BIG.length - 1, Math.floor(Math.log10(v) / 3) - 2);
	const scaled = v / 10 ** ((tier + 2) * 3);
	return `${(Math.floor(scaled * 100) / 100).toFixed(2)} ${BIG[tier]}`;
}

/** Clips per second, with one decimal under 100. */
export function formatRate(n: number) {
	if (n < 100) return (Math.round(n * 10) / 10).toLocaleString("en-US");
	return formatCount(n);
}
