// Screen geometry for the agent: where Clippy stands next to a target, how
// long the walk takes, and how Outline title bars fit on screen. Pure.

import { PET } from "../../shared/layout.js";
import type { Point, Rect } from "../../shared/types.js";

/** Room the agent's speech bubble takes above Clippy's body, at scale 1. */
export const BUBBLE_ZONE = { width: 270, height: 150 };
/** Gap kept between Clippy's footprint and the target. */
const GAP = 14;
const MARGIN = 4;

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));

/**
 * The screen area Clippy covers while helping: his body plus the speech
 * bubble zone above it, for a pet window at `pos`.
 */
export function footprint(pos: Point, scale: number): Rect {
	const bodyX = pos.x + PET.body.x * scale;
	const bodyY = pos.y + PET.body.y * scale;
	const bodyW = PET.body.width * scale;
	const bodyH = PET.body.height * scale;
	const zoneW = Math.max(bodyW, BUBBLE_ZONE.width * scale);
	const zoneH = BUBBLE_ZONE.height * scale;
	const cx = bodyX + bodyW / 2;
	return {
		x: cx - zoneW / 2,
		y: bodyY - zoneH,
		width: zoneW,
		height: bodyH + zoneH,
	};
}

/** Pet window position whose footprint has its top-left corner at `p`. */
function posForFootprint(p: Point, scale: number): Point {
	const probe = footprint({ x: 0, y: 0 }, scale);
	return { x: Math.round(p.x - probe.x), y: Math.round(p.y - probe.y) };
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
	return (
		a.x < b.x + b.width + gap &&
		b.x < a.x + a.width + gap &&
		a.y < b.y + b.height + gap &&
		b.y < a.y + a.height + gap
	);
}

export function inside(a: Rect, area: Rect): boolean {
	return (
		a.x >= area.x - 0.5 &&
		a.y >= area.y - 0.5 &&
		a.x + a.width <= area.x + area.width + 0.5 &&
		a.y + a.height <= area.y + area.height + 0.5
	);
}

/** Moves footprint-sized rect `r` into `area` (assumes it fits). */
function clampInto(r: Rect, area: Rect): Point {
	return {
		x: clamp(r.x, area.x + MARGIN, area.x + area.width - r.width - MARGIN),
		y: clamp(r.y, area.y + MARGIN, area.y + area.height - r.height - MARGIN),
	};
}

/**
 * Pet window position next to `target` on the display with work area
 * `workArea`: Clippy's footprint stays inside the work area and clear of
 * the target. Tries right, left, below and above; when none fits, returns
 * the work-area corner farthest from the target's center.
 */
export function placeNear(
	target: Rect,
	scale: number,
	workArea: Rect,
): { pos: Point; fallback: boolean } {
	const fp = footprint({ x: 0, y: 0 }, scale);
	const w = fp.width;
	const h = fp.height;
	const tcx = target.x + target.width / 2;
	const tcy = target.y + target.height / 2;
	const candidates: Rect[] = [
		{ x: target.x + target.width + GAP, y: tcy - h * 0.6, width: w, height: h },
		{ x: target.x - GAP - w, y: tcy - h * 0.6, width: w, height: h },
		{ x: tcx - w / 2, y: target.y + target.height + GAP, width: w, height: h },
		{ x: tcx - w / 2, y: target.y - GAP - h, width: w, height: h },
	];
	if (w + MARGIN * 2 <= workArea.width && h + MARGIN * 2 <= workArea.height) {
		for (const c of candidates) {
			const p = clampInto(c, workArea);
			const placed = { x: p.x, y: p.y, width: w, height: h };
			if (!overlaps(placed, target, GAP / 2))
				return { pos: posForFootprint(p, scale), fallback: false };
		}
	}
	const corners: Point[] = [
		{ x: workArea.x + MARGIN, y: workArea.y + MARGIN },
		{ x: workArea.x + workArea.width - w - MARGIN, y: workArea.y + MARGIN },
		{ x: workArea.x + MARGIN, y: workArea.y + workArea.height - h - MARGIN },
		{
			x: workArea.x + workArea.width - w - MARGIN,
			y: workArea.y + workArea.height - h - MARGIN,
		},
	];
	let best = corners[0];
	let bestD = -1;
	for (const c of corners) {
		const d = Math.hypot(c.x + w / 2 - tcx, c.y + h / 2 - tcy);
		if (d > bestD) {
			bestD = d;
			best = c;
		}
	}
	return { pos: posForFootprint(best, scale), fallback: true };
}

/** Walk duration in ms for a move of `from` to `to`: 300 to 1000. */
export function walkDuration(from: Point, to: Point): number {
	const d = Math.hypot(to.x - from.x, to.y - from.y);
	return Math.round(clamp(250 + d * 0.6, 300, 1000));
}

export const TITLE_MAX = 60;

/** Truncates an Outline description to 60 characters, ending in an ellipsis. */
export function truncateTitle(s: string, max = TITLE_MAX): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * "above" when the title bar fits between the target's top and the
 * display's top edge, "below" otherwise.
 */
export function titleBarSide(
	target: Rect,
	display: Rect,
	barHeight: number,
): "above" | "below" {
	return target.y - display.y >= barHeight ? "above" : "below";
}
