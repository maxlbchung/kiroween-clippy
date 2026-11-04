import assert from "node:assert/strict";
import { test } from "node:test";
import { itemsFor } from "../src/renderer/common/costumes.ts";
import {
	costumeKey,
	creditsForScore,
	owns,
	POINTS_PER_CREDIT,
	PRICES,
	priceOf,
} from "../src/shared/shop.ts";

const empty = { credits: 0, unlocked: [] };

test("free items and empty slots are always owned", () => {
	assert.equal(priceOf("hat", "tophat"), 0);
	assert.ok(owns(empty, "hat", "tophat"));
	assert.ok(owns(empty, "hat", null));
	assert.ok(owns(empty, "finish", "silver"));
});

test("priced items need to be unlocked", () => {
	assert.ok(priceOf("hat", "crown") > 0);
	assert.ok(!owns(empty, "hat", "crown"));
	assert.ok(owns({ credits: 0, unlocked: ["hat:crown"] }, "hat", "crown"));
});

test("prices are keyed per category", () => {
	assert.notEqual(
		costumeKey("hat", "pumpkin"),
		costumeKey("finish", "pumpkin"),
	);
	assert.ok(
		!owns({ credits: 0, unlocked: ["hat:pumpkin"] }, "finish", "pumpkin"),
	);
});

test("every price is a positive whole number of credits", () => {
	for (const [key, price] of Object.entries(PRICES)) {
		assert.ok(Number.isInteger(price) && price > 0, key);
	}
});

test("credits round down from the score", () => {
	assert.equal(creditsForScore(0), 0);
	assert.equal(creditsForScore(POINTS_PER_CREDIT - 1), 0);
	assert.equal(creditsForScore(POINTS_PER_CREDIT * 3 + 1), 3);
	assert.equal(creditsForScore(-50), 0);
});

test("every price names a real costume item", () => {
	for (const key of Object.keys(PRICES)) {
		const [category, id] = key.split(":");
		assert.ok(
			itemsFor(category).some((item) => item.id === id),
			`${key} is not in the catalog`,
		);
	}
});
