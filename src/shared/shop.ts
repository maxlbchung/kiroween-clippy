// Costume shop rules shared by the main process (which owns the wallet) and
// the wardrobe. Items missing from PRICES are free.

import type { CostumeCategory, WalletSettings } from "./types.js";

/** Points of game score per credit earned. */
export const POINTS_PER_CREDIT = 25;

/** Price in credits, keyed by `category:id` because ids repeat across categories. */
export const PRICES: Record<string, number> = {
	"hat:witch": 30,
	"hat:cowboy": 30,
	"hat:propeller": 30,
	"hat:wizard": 60,
	"hat:pumpkin": 60,
	"hat:horns": 60,
	"hat:crown": 120,
	"hat:halo": 120,
	"eyewear:nerd": 30,
	"eyewear:monocle": 30,
	"eyewear:3d": 30,
	"eyewear:hearts": 60,
	"eyewear:pixel": 120,
	"mustache:pencil": 30,
	"mustache:handlebar": 30,
	"mustache:walrus": 60,
	"mustache:droopy": 60,
	"cape:hero": 60,
	"cape:vampire": 60,
	"cape:royal": 120,
	"cape:spectral": 120,
	"neck:scarf": 30,
	"neck:bandana": 30,
	"neck:medal": 120,
	"finish:copper": 30,
	"finish:rose": 30,
	"finish:slime": 60,
	"finish:midnight": 60,
	"finish:frost": 60,
	"finish:pumpkin": 60,
	"finish:gold": 120,
};

export function costumeKey(category: CostumeCategory, id: string) {
	return `${category}:${id}`;
}

/** Price of an item, or 0 when it is free. */
export function priceOf(category: CostumeCategory, id: string | null) {
	return id ? (PRICES[costumeKey(category, id)] ?? 0) : 0;
}

/** True for free items, empty slots and items already bought. */
export function owns(
	wallet: WalletSettings,
	category: CostumeCategory,
	id: string | null,
) {
	return (
		priceOf(category, id) === 0 ||
		wallet.unlocked.includes(costumeKey(category, id))
	);
}

export function creditsForScore(score: number) {
	return Math.max(0, Math.floor(score / POINTS_PER_CREDIT));
}
