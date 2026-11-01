import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bodyRect,
	clampPet,
	clampRing,
	defaultPetPosition,
	placePanel,
} from "../dist/main/placement.js";
import { MENU, PANEL_PAD, PANELS, PET } from "../dist/shared/layout.js";

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const within = (r, wa) =>
	r.x >= wa.x &&
	r.y >= wa.y &&
	r.x + r.width <= wa.x + wa.width &&
	r.y + r.height <= wa.y + wa.height;
const content = (b) => ({
	x: b.x + PANEL_PAD,
	y: b.y + PANEL_PAD,
	width: b.width - PANEL_PAD * 2,
	height: b.height - PANEL_PAD * 2,
});

test("default position keeps Clippy fully on screen, bottom-right", () => {
	for (const scale of [0.8, 1, 1.25]) {
		const pos = defaultPetPosition(scale, WA);
		const body = bodyRect({ ...pos, width: 0, height: 0 }, scale);
		assert.ok(within(body, WA), `scale ${scale}`);
		assert.ok(body.x > WA.width / 2 && body.y > WA.height / 2);
	}
});

test("clampPet pulls an off-screen Clippy back inside the work area", () => {
	const pos = clampPet({ x: -500, y: 5000 }, 1, WA);
	assert.ok(within(bodyRect({ ...pos, width: 0, height: 0 }, 1), WA));
});

test("clampRing keeps every menu button on screen", () => {
	const pos = clampRing({ x: WA.width - 60, y: -100 }, 1, WA);
	const left = pos.x + PET.ring.cx - PET.ring.rx - PET.ring.button / 2;
	const top = pos.y + PET.ring.cy - PET.ring.ry - PET.ring.button / 2;
	const right = pos.x + PET.ring.cx + PET.ring.rx + PET.ring.button / 2;
	assert.ok(left >= 0 && top >= 0 && right <= WA.width);
});

test("every menu button fits inside the pet window", () => {
	for (const { id, angle } of MENU) {
		const rad = (angle * Math.PI) / 180;
		const x = PET.ring.cx + Math.cos(rad) * PET.ring.rx;
		const y = PET.ring.cy + Math.sin(rad) * PET.ring.ry;
		const r = PET.ring.button / 2;
		assert.ok(
			x - r >= 0 && x + r <= PET.width && y - r >= 0 && y + r <= PET.height,
			id,
		);
	}
});

test("panels open on the right when there is room, left otherwise, and stay on screen", () => {
	for (const [name, panel] of Object.entries(PANELS)) {
		const leftPet = { x: 40, y: 300, width: PET.width, height: PET.height };
		const a = placePanel({ petBounds: leftPet, scale: 1, panel, workArea: WA });
		assert.equal(a.side, "right", name);
		assert.ok(within(content(a.bounds), WA), `${name} right`);

		const rightPet = {
			x: WA.width - PET.width,
			y: 600,
			width: PET.width,
			height: PET.height,
		};
		const b = placePanel({
			petBounds: rightPet,
			scale: 1,
			panel,
			workArea: WA,
		});
		assert.equal(b.side, "left", name);
		assert.ok(within(content(b.bounds), WA), `${name} left`);
		assert.ok(b.tailY >= 24 && b.tailY <= panel.height - 24);
	}
});

test("panel side is sticky while it still fits", () => {
	const pet = { x: 800, y: 300, width: PET.width, height: PET.height };
	const p = placePanel({
		petBounds: pet,
		scale: 1,
		panel: PANELS.chat,
		workArea: WA,
		preferSide: "left",
	});
	assert.equal(p.side, "left");
});
