// Wallet rules: credits come from arcade rounds and buy costume items. Only the
// main process changes the wallet; renderers ask through IPC.

import { costumeKey, creditsForScore, owns, priceOf } from "../shared/shop.js";
import type {
	CostumeCategory,
	CostumeSettings,
	GameRoundReward,
	PurchaseResult,
	SettingsPatch,
} from "../shared/types.js";
import type { Settings } from "./settings.js";

const CATEGORIES: CostumeCategory[] = [
	"hat",
	"eyewear",
	"mustache",
	"cape",
	"neck",
	"finish",
];

/** Adds the credits a round's score is worth and returns the new balance. */
export function awardCredits(
	settings: Settings,
	score: number,
): GameRoundReward {
	const earned = creditsForScore(score);
	const credits = settings.data.wallet.credits + earned;
	if (earned > 0) settings.patch({ wallet: { credits } });
	return { earned, credits };
}

/** Spends credits on one costume item. Buying an owned item is a no-op. */
export function buyCostume(
	settings: Settings,
	category: CostumeCategory,
	id: string,
): PurchaseResult {
	const wallet = settings.data.wallet;
	const price = priceOf(category, typeof id === "string" ? id : null);
	if (!CATEGORIES.includes(category) || price === 0)
		return { ok: false, error: "That item isn't for sale." };
	if (owns(wallet, category, id))
		return { ok: true, settings: settings.public };
	if (wallet.credits < price)
		return {
			ok: false,
			error: "Not enough credits. Play arcade games to earn more!",
		};
	return {
		ok: true,
		settings: settings.patch({
			wallet: {
				credits: wallet.credits - price,
				unlocked: [...wallet.unlocked, costumeKey(category, id)],
			},
		}),
	};
}

/**
 * Cleans a settings patch from a renderer: drops any wallet change and any
 * costume item that hasn't been bought.
 */
export function guardPatch(
	settings: Settings,
	patch: SettingsPatch,
): SettingsPatch {
	if (!patch || typeof patch !== "object") return {};
	const { wallet: _ignored, ...rest } = patch;
	if (!rest.costume || typeof rest.costume !== "object") return rest;
	const costume: Partial<CostumeSettings> = {};
	for (const [key, value] of Object.entries(rest.costume)) {
		const category = key as CostumeCategory;
		if (!CATEGORIES.includes(category)) continue;
		const id = typeof value === "string" ? value : null;
		if (owns(settings.data.wallet, category, id))
			costume[category] = value as string;
	}
	return { ...rest, costume };
}

/** Marks items already being worn as bought, so locking them never strips an outfit. */
export function keepWornItems(settings: Settings) {
	const { costume, wallet } = settings.data;
	const unlocked = [...wallet.unlocked];
	for (const category of CATEGORIES) {
		const id = costume[category];
		if (id && !owns({ ...wallet, unlocked }, category, id))
			unlocked.push(costumeKey(category, id));
	}
	if (unlocked.length !== wallet.unlocked.length)
		settings.patch({ wallet: { unlocked } });
}
