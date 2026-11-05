// Clippy character: SVG markup (pure) + live costume/expression helpers (DOM).

import type { Costume, CostumeSlot } from "../../shared/types.js";
import { CATEGORIES, FINISHES, itemParts } from "./costumes.js";

export const VIEWBOX = { x: 0, y: -40, w: 200, h: 320 };
export const EYES = {
	l: { x: 82, y: 102, rx: 14.5, ry: 16.5 },
	r: { x: 120, y: 100, rx: 14.5, ry: 16.5 },
};

// Wire centre-line: three nested U-turns, like a real paper clip.
export const WIRE =
	"M82 190 L82 100 A19 19 0 0 1 120 100 L120 222 A27 27 0 0 1 66 222 L66 74 A34 34 0 0 1 134 74 L134 200";

// Draw order, back to front.
const SLOT_ORDER_BACK: CostumeSlot[] = ["back"];
const SLOT_ORDER_FRONT: (CostumeSlot | "@face")[] = [
	"neck",
	"@face",
	"mustache",
	"eyewear",
	"capeFront",
	"hat",
];

function finishVars(id: string | null | undefined) {
	const f = FINISHES[id] || FINISHES.silver;
	return `--wire-dark:${f.dark};--wire-base:${f.base};--wire-shade:${f.shade};--wire-light:${f.light};--wire-glow:${f.glow || "transparent"}`;
}

function eye(side: "l" | "r") {
	const e = EYES[side];
	return `
    <g class="c-eye c-eye-${side}">
      <ellipse class="c-sclera" cx="${e.x}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}"/>
      <g class="c-pupil" data-eye="${side}">
        <circle class="c-iris" cx="${e.x}" cy="${e.y + 2}" r="6.6"/>
        <circle class="c-glint" cx="${e.x - 2.3}" cy="${e.y - 0.6}" r="2.2"/>
      </g>
      <path class="c-lid" d="M${e.x - e.rx - 1} ${e.y} Q${e.x} ${e.y + 5} ${e.x + e.rx + 1} ${e.y}"/>
    </g>`;
}

/** Full character SVG. `uid` must be unique within the document. */
export function clippyMarkup({
	uid = "c",
	costume = {},
	className = "",
}: {
	uid?: string;
	costume?: Partial<Costume>;
	className?: string;
} = {}) {
	const slots: Partial<Record<CostumeSlot, string>> = {};
	for (const cat of CATEGORIES) {
		if (cat.id === "finish") continue;
		const itemId = costume[cat.id];
		if (!itemId) continue;
		Object.assign(slots, itemParts(itemId, `${uid}-${cat.id}`));
	}
	const slot = (name: CostumeSlot) =>
		`<g class="c-slot" data-slot="${name}">${slots[name] || ""}</g>`;
	const face = `
    <g class="c-face">
      ${eye("l")}${eye("r")}
      <path class="c-brow c-brow-l" d="M68 79 Q82 70 96 77"/>
      <path class="c-brow c-brow-r" d="M106 75 Q120 68 134 75"/>
    </g>`;
	const front = SLOT_ORDER_FRONT.map((s) =>
		s === "@face" ? face : slot(s),
	).join("");
	return `
  <svg class="clippy ${className}" viewBox="${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg"
       style="${finishVars(costume.finish)}" aria-hidden="true" overflow="visible">
    <g class="c-root">
      ${SLOT_ORDER_BACK.map(slot).join("")}
      <g class="c-wire">
        <path class="c-wire-glow" d="${WIRE}"/>
        <path class="c-wire-outline" d="${WIRE}"/>
        <path class="c-wire-base" d="${WIRE}"/>
        <path class="c-wire-shade" d="${WIRE}" transform="translate(1.7 1.9)"/>
        <path class="c-wire-light" d="${WIRE}" transform="translate(-1.8 -1.7)"/>
      </g>
      ${front}
    </g>
  </svg>`;
}

/** A bare paper clip in Clippy's wire and `finish`, with no face or costume. */
export function paperclipMarkup(finish?: string | null, className = "") {
	return `
  <svg class="${className}" viewBox="54 30 92 230" xmlns="http://www.w3.org/2000/svg"
       style="${finishVars(finish)}" aria-hidden="true">
    <g class="c-wire">
      <path class="c-wire-outline" d="${WIRE}"/>
      <path class="c-wire-base" d="${WIRE}"/>
      <path class="c-wire-shade" d="${WIRE}" transform="translate(1.7 1.9)"/>
      <path class="c-wire-light" d="${WIRE}" transform="translate(-1.8 -1.7)"/>
    </g>
  </svg>`;
}

/**
 * Update an existing Clippy SVG to a new costume without re-creating it,
 * so idle animations keep running. Changed slots get a pop-in animation.
 */
export function applyCostume(
	svg: SVGSVGElement,
	costume: Costume,
	prev: Partial<Costume> = {},
	{ uid = "c", animate = true }: { uid?: string; animate?: boolean } = {},
) {
	svg.setAttribute("style", finishVars(costume.finish));
	const changed = [];
	for (const cat of CATEGORIES) {
		if (cat.id === "finish") continue;
		if (costume[cat.id] === prev[cat.id]) continue;
		const itemId = costume[cat.id];
		const parts = itemId ? itemParts(itemId, `${uid}-${cat.id}`) : {};
		for (const slotName of cat.slots) {
			const el = svg.querySelector(`[data-slot="${slotName}"]`);
			if (!el) continue;
			el.innerHTML = parts[slotName] || "";
			if (animate && parts[slotName]) {
				el.animate(
					[
						{ transform: "translateY(-18px) scale(.6)", opacity: 0 },
						{
							transform: "translateY(3px) scale(1.06)",
							opacity: 1,
							offset: 0.65,
						},
						{ transform: "none", opacity: 1 },
					],
					{ duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" },
				);
			}
		}
		changed.push(cat.id);
	}
	if (animate && costume.finish !== prev.finish && prev.finish) {
		svg
			.querySelector(".c-wire")
			?.animate([{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }], {
				duration: 500,
				easing: "ease-out",
			});
	}
	return changed;
}

/** Blink both eyes (Web Animations, so it composes with CSS moods). */
export function blink(
	svg: SVGSVGElement,
	{ double = false }: { double?: boolean } = {},
) {
	const frames = [
		{ transform: "scaleY(1)" },
		{ transform: "scaleY(.08)", offset: 0.45 },
		{ transform: "scaleY(1)" },
	];
	svg.querySelectorAll(".c-eye").forEach((e) => {
		const a = e.animate(frames, { duration: 170, easing: "ease-in-out" });
		if (double)
			a.onfinish = () =>
				e.animate(frames, { duration: 150, delay: 70, easing: "ease-in-out" });
	});
}

/**
 * Smooth pupil tracking. Call `lookAt(x, y)` with a point in client px, or
 * `lookDir(dx, dy)` with a unit-ish direction; `tick()` every frame.
 */
export function createGaze(svg: SVGSVGElement) {
	const pupils = [...svg.querySelectorAll(".c-pupil")];
	const cur = { x: 0, y: 0 };
	const target = { x: 0, y: 0 };
	let shown = "";
	return {
		lookAt(px, py) {
			const r = svg.getBoundingClientRect();
			const k = r.width / VIEWBOX.w;
			const ex = r.left + ((EYES.l.x + EYES.r.x) / 2 - VIEWBOX.x) * k;
			const ey = r.top + ((EYES.l.y + EYES.r.y) / 2 - VIEWBOX.y) * k;
			const dx = px - ex;
			const dy = py - ey;
			const d = Math.hypot(dx, dy) || 1;
			const reach = Math.min(1, d / 160);
			target.x = (dx / d) * reach;
			target.y = (dy / d) * reach;
		},
		lookDir(dx, dy) {
			target.x = Math.max(-1, Math.min(1, dx));
			target.y = Math.max(-1, Math.min(1, dy));
		},
		/** Advance smoothing; returns true while the pupils are still moving. */
		tick(dt = 1 / 60) {
			const t = 1 - 0.0008 ** dt;
			cur.x += (target.x - cur.x) * t;
			cur.y += (target.y - cur.y) * t;
			const move = `translate(${(cur.x * 6.2).toFixed(2)} ${(cur.y * 7.4).toFixed(2)})`;
			// Skips the DOM write once the pupils have settled.
			if (move !== shown) {
				shown = move;
				for (const p of pupils) p.setAttribute("transform", move);
			}
			return Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.002;
		},
	};
}
