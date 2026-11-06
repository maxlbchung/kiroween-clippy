// Hide & Seek pile: builds window elements from catalogue drafts, measures
// their hiding boxes for the layout rules, and fills boxes with Clippies and
// decoys. Holds no game state.

import type { Costume } from "../../../shared/types.js";
import { clippyMarkup } from "../../common/clippy.js";
import { esc } from "../../common/ui.js";
import type { DecoyKind, Draft } from "./catalog.js";
import {
	contains,
	coverage,
	type PileWindow,
	type Pose,
	poseFrame,
	type Rect,
	type Slot,
	type Spot,
} from "./layout.js";

/** One window of the pile: its element, its draft and its model for the rules. */
export type Win = {
	el: HTMLElement;
	draft: Draft;
	model: PileWindow;
	/** Hiding boxes in the same order as `model.slots`. */
	slots: HTMLElement[];
	/** The scrolling content element, if the content scrolls. */
	scroller: HTMLElement | null;
};

/** Height of a window rolled up to its title bar. */
export const SHADED_H = 26;
/** Stacking order of hiding boxes inside a window, as set in seek.css. */
const SLOT_Z = 3;
/** Largest share of a hiding box that content drawn above it may cover. */
const MAX_COVERED = 0.3;

export function windowMarkup(draft: Draft) {
	return `
    <div class="titlebar">
      <span class="ti ${esc(draft.icon)}"></span>
      <div class="titlebar-text">${esc(draft.title)}</div>
      ${draft.dialog ? "" : '<span class="icon-btn" data-act="shade" title="Roll up"><span class="min-glyph"></span></span>'}
      <span class="icon-btn" data-act="close" title="Close"><span class="x-glyph"></span></span>
    </div>
    <div class="sw-body">${draft.body}</div>`;
}

/** Moves a window element to `rect` and sets its stacking order. */
export function placeWindow(el: HTMLElement, rect: Rect, z?: number) {
	el.style.transform = `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`;
	if (z !== undefined) el.style.zIndex = String(z);
}

/** Creates a window element for `draft` in `parent`, placed at `rect`. */
export function createWindow(
	parent: HTMLElement,
	draft: Draft,
	rect: Rect,
	z: number,
) {
	const el = document.createElement("div");
	el.className = `sw frame-window ${draft.cls}`;
	el.style.width = `${rect.w}px`;
	el.style.height = `${rect.h}px`;
	el.innerHTML = windowMarkup(draft);
	placeWindow(el, rect, z);
	parent.appendChild(el);
	return el;
}

const relRect = (r: DOMRect, to: DOMRect): Rect => ({
	x: r.left - to.left,
	y: r.top - to.top,
	w: r.width,
	h: r.height,
});

/**
 * Measures a laid-out window into a model for the layout rules. A hiding box
 * counts only if every clipping element between it and the content root shows
 * all of it and content stacked above it covers little of it, so the rules
 * never see a box that its own window hides. Boxes that do not count stay
 * empty.
 */
export function measureWindow(
	el: HTMLElement,
	draft: Draft,
	rect: Rect,
	z: number,
): Win {
	const frame = el.getBoundingClientRect();
	const body = el.querySelector<HTMLElement>(".sw-body");
	const scroller = el.querySelector<HTMLElement>(".scroll");
	const root = scroller ?? body;
	const rootBox = root.getBoundingClientRect();
	const scrolls = !!scroller && scroller.scrollHeight > scroller.clientHeight;
	const content: Rect = {
		x: rootBox.left - frame.left + root.clientLeft,
		y: rootBox.top - frame.top + root.clientTop,
		w: root.clientWidth,
		h: root.clientHeight,
	};
	const above: Rect[] = [];
	for (const c of body.querySelectorAll<HTMLElement>("*")) {
		if (c.closest(".slot")) continue;
		if (Number.parseInt(getComputedStyle(c).zIndex, 10) > SLOT_Z)
			above.push(relRect(c.getBoundingClientRect(), frame));
	}
	const slots: Slot[] = [];
	const slotEls: HTMLElement[] = [];
	for (const s of el.querySelectorAll<HTMLElement>(".slot")) {
		const box = s.getBoundingClientRect();
		let shown = coverage(relRect(box, frame), above) <= MAX_COVERED;
		for (let a = s.parentElement; a && a !== root; a = a.parentElement) {
			const style = getComputedStyle(a);
			if (style.overflowX === "visible" && style.overflowY === "visible")
				continue;
			if (
				!contains(
					relRect(a.getBoundingClientRect(), frame),
					relRect(box, frame),
				)
			)
				shown = false;
		}
		if (!shown) continue;
		slots.push({
			pose: (s.dataset.pose as Pose) ?? "up",
			rect: {
				x: box.left - rootBox.left - root.clientLeft + root.scrollLeft,
				y: box.top - rootBox.top - root.clientTop + root.scrollTop,
				w: box.width,
				h: box.height,
			},
		});
		slotEls.push(s);
	}
	return {
		el,
		draft,
		slots: slotEls,
		scroller: scrolls ? scroller : null,
		model: {
			kind: draft.kind,
			rect,
			z,
			content,
			scrollHeight: scrolls ? scroller.scrollHeight : 0,
			slots,
		},
	};
}

function frameStyle(pose: Pose, w: number, h: number) {
	const f = poseFrame(pose, w, h);
	return `left:${f.left.toFixed(1)}px;top:${f.top.toFixed(1)}px;width:${f.width.toFixed(1)}px;height:${f.height.toFixed(1)}px;transform-origin:${f.ox.toFixed(1)}px ${f.oy.toFixed(1)}px;transform:rotate(${f.rot}deg)`;
}

/** Clippy posed to fill a `w`×`h` hiding box. `uid` must be unique in the page. */
export function clippyInBox(
	uid: string,
	costume: Partial<Costume>,
	pose: Pose,
	w: number,
	h: number,
) {
	return `<span class="hc" style="${frameStyle(pose, w, h)}"><span class="wig">${clippyMarkup({ uid, costume })}</span></span>`;
}

/** A decoy drawn where Clippy's wire would be in the same pose. */
export function decoyInBox(kind: DecoyKind, pose: Pose, w: number, h: number) {
	return `<span class="hc" style="${frameStyle(pose, w, h)}"><img class="dart" src="art/${kind}.svg" alt="" draggable="false"></span>`;
}

/**
 * Creates the element for a spot: fills a window's hiding box, or adds a box
 * on the desk behind the pile. Returns the box element.
 */
export function fillSpot(
	desk: HTMLElement,
	wins: readonly Win[],
	spot: Spot,
	inner: (pose: Pose, w: number, h: number) => string,
	cls: string,
) {
	if (spot.kind === "slot") {
		const el = wins[spot.win].slots[spot.slot];
		const { pose, rect } = wins[spot.win].model.slots[spot.slot];
		el.className = `slot ${cls} pose-${pose}`;
		el.innerHTML = inner(pose, rect.w, rect.h);
		return el;
	}
	const el = document.createElement("i");
	const r = spot.rect;
	el.className = `slot desk-spot ${cls} pose-${spot.pose}`;
	el.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;transform:rotate(${spot.rot}deg)`;
	el.innerHTML = inner(spot.pose, r.w, r.h);
	desk.appendChild(el);
	return el;
}
