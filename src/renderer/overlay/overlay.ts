// Agent overlay page: draws the current Outline and Clippy's task bubble,
// and reports title-bar and bubble clicks to the main process.

import type { OverlayState } from "../../shared/types.js";
import {
	$,
	api,
	applyPrefs,
	esc,
	installClickThrough,
	reducedMotion,
	sfx,
} from "../common/ui.js";

const outline = $("#outline");
const step = $(".ol-step", outline);
const title = $(".ol-title", outline);
const bubble = $("#bubble");
const bubbleText = $(".ob-text", bubble);
const bubbleButtons = $(".ob-buttons", bubble);

applyPrefs(await api.getSettings());
api.onSettings(applyPrefs);
const clickThrough = installClickThrough();

/** Outline frame thickness, so the inner edge sits on the target's bounds. */
const FRAME = 4;
const GAP = 16;
const EDGE = 6;

let bubbleId: number | null = null;
let shownText = "";
let typeTimer: ReturnType<typeof setInterval> | null = null;

function renderOutline(o: OverlayState["outline"]) {
	if (!o) {
		outline.classList.remove("show");
		return;
	}
	const { x, y, width, height } = o.rect;
	outline.style.left = `${x - FRAME}px`;
	outline.style.top = `${y - FRAME}px`;
	outline.style.width = `${width + FRAME * 2}px`;
	outline.style.height = `${height + FRAME * 2}px`;
	outline.classList.toggle("above", o.side === "above");
	outline.classList.toggle("below", o.side === "below");
	outline.classList.toggle("tip", o.kind === "tip");
	step.textContent = o.step ? `${o.step.n}/${o.step.total}` : "";
	title.textContent = o.title;
	title.title = o.title;
	outline.classList.add("show");
}

function typeOut(text: string) {
	if (typeTimer) clearInterval(typeTimer);
	if (reducedMotion()) {
		bubbleText.textContent = text;
		return;
	}
	let i = 0;
	bubbleText.textContent = "";
	typeTimer = setInterval(() => {
		i += 2;
		bubbleText.textContent = text.slice(0, i);
		if (i >= text.length && typeTimer) clearInterval(typeTimer);
	}, 18);
}

function placeBubble(anchor: {
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const w = bubble.offsetWidth;
	const h = bubble.offsetHeight;
	const cx = anchor.x + anchor.width / 2;
	const below = anchor.y - GAP - h < EDGE;
	const top = below ? anchor.y + anchor.height + GAP : anchor.y - GAP - h;
	const left = Math.max(
		EDGE,
		Math.min(window.innerWidth - w - EDGE, cx - w / 2),
	);
	bubble.style.left = `${left}px`;
	bubble.style.top = `${Math.max(EDGE, top)}px`;
	bubble.classList.toggle("below", below);
	const tail = Math.max(16, Math.min(w - 16, cx - left));
	bubble.style.setProperty("--tail-x", `${tail}px`);
}

function renderBubble(b: OverlayState["bubble"]) {
	if (!b) {
		bubble.classList.remove("show");
		bubbleId = null;
		shownText = "";
		return;
	}
	const fresh = b.id !== bubbleId;
	bubbleId = b.id;
	if (fresh || b.text !== shownText) {
		shownText = b.text;
		bubbleButtons.innerHTML = b.buttons
			.map(
				(btn) =>
					`<button type="button" class="btn btn-sm${btn.primary ? " btn-primary" : ""}" data-bubble-btn="${esc(btn.id)}">${esc(btn.label)}</button>`,
			)
			.join("");
		// Measure with the full text so placement does not jump while typing.
		bubbleText.textContent = b.text;
		placeBubble(b.anchor);
		typeOut(b.text);
		if (fresh) sfx.pop();
	} else placeBubble(b.anchor);
	bubble.classList.add("show");
}

api.onOverlay((state: OverlayState) => {
	renderOutline(state.outline);
	renderBubble(state.bubble);
	clickThrough.set(false);
});

outline.addEventListener("click", (e) => {
	const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-btn]");
	if (!btn) return;
	sfx.select();
	api.overlayEvent({
		kind: "outline",
		button: btn.dataset.btn === "skip" ? "skip" : "close",
	});
});

bubble.addEventListener("click", (e) => {
	if (bubbleId === null) return;
	const target = e.target as HTMLElement;
	const btn = target.closest<HTMLElement>("[data-bubble-btn]");
	if (btn) {
		sfx.select();
		api.overlayEvent({
			kind: "bubble",
			id: bubbleId,
			button: btn.dataset.bubbleBtn ?? "",
		});
	} else if (target.closest(".ob-close")) {
		sfx.close();
		api.overlayEvent({ kind: "bubble", id: bubbleId, button: "close" });
	}
});

bubble.addEventListener("mouseenter", () => {
	if (bubbleId !== null)
		api.overlayEvent({ kind: "hover", id: bubbleId, on: true });
});
bubble.addEventListener("mouseleave", () => {
	if (bubbleId !== null)
		api.overlayEvent({ kind: "hover", id: bubbleId, on: false });
});
