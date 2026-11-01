// Wardrobe: dress Clippy up. Changes save instantly and show live on the pet.

import type {
	Costume,
	CostumeCategory,
	RendererContext,
} from "../../../shared/types.js";
import {
	applyCostume,
	blink,
	clippyMarkup,
	createGaze,
	EYES,
	WIRE,
} from "../../common/clippy.js";
import {
	CATEGORIES,
	EMPTY_COSTUME,
	FINISHES,
	finishSwatch,
	ITEM_BY_ID,
	itemParts,
	itemsFor,
} from "../../common/costumes.js";
import { icon } from "../../common/icons.js";
import { $, $$, esc, reducedMotion, sfx } from "../../common/ui.js";

let lastTab = "hat";
let uidSeq = 0;

function ghost() {
	return `
    <path d="${WIRE}" fill="none" stroke="#17171c" stroke-opacity=".1" stroke-width="10" stroke-linecap="round"/>
    <ellipse cx="${EYES.l.x}" cy="${EYES.l.y}" rx="${EYES.l.rx}" ry="${EYES.l.ry}" fill="#fff" stroke="#17171c" stroke-opacity=".18" stroke-width="2"/>
    <ellipse cx="${EYES.r.x}" cy="${EYES.r.y}" rx="${EYES.r.rx}" ry="${EYES.r.ry}" fill="#fff" stroke="#17171c" stroke-opacity=".18" stroke-width="2"/>`;
}

function thumb(category, id) {
	if (!id) return icon("none", 30);
	if (category.id === "finish")
		return `<svg viewBox="${category.thumb}" class="thumb-svg">${finishSwatch(id)}</svg>`;
	const parts = itemParts(id, `t${++uidSeq}`);
	const back = parts.back || "";
	const front = Object.entries(parts)
		.filter(([k]) => k !== "back")
		.map(([, v]) => v)
		.join("");
	return `<svg viewBox="${category.thumb}" class="thumb-svg" overflow="hidden">${back}${ghost()}${front}</svg>`;
}

function outfitTitle(c) {
	const worn = CATEGORIES.filter((cat) => cat.id !== "finish" && c[cat.id]).map(
		(cat) => ITEM_BY_ID[c[cat.id]]?.name,
	);
	if (!worn.length)
		return c.finish && c.finish !== "silver"
			? `${FINISHES[c.finish]?.name} Clippy`
			: "Classic Clippy";
	return worn.join(" · ");
}

function stars(c) {
	const n = CATEGORIES.filter((cat) =>
		cat.id === "finish" ? c.finish && c.finish !== "silver" : c[cat.id],
	).length;
	return "★".repeat(n) + "☆".repeat(CATEGORIES.length - n);
}

export function mount(el: HTMLElement, ctx: RendererContext) {
	let costume: Costume = { ...EMPTY_COSTUME, ...ctx.settings.costume };

	el.innerHTML = `
    <div class="wardrobe">
      <section class="ward-stage">
        <div class="ward-spot"></div>
        <div class="ward-floor"></div>
        <div class="ward-preview"><div class="ward-bob">${clippyMarkup({ uid: "wp", costume })}</div></div>
        <div class="ward-meta">
          <div class="ward-name px"></div>
          <div class="ward-stars" title="Fashion level"></div>
        </div>
        <div class="ward-actions">
          <button class="btn btn-sm" data-act="random">${icon("dice", 16)}Surprise me</button>
          <button class="btn btn-sm" data-act="reset" title="Back to basics">${icon("reset", 16)}</button>
        </div>
      </section>
      <section class="ward-closet">
        <div class="tabs" role="tablist">
          ${CATEGORIES.map((c) => `<button class="tab" role="tab" data-tab="${c.id}" aria-selected="false">${esc(c.label)}</button>`).join("")}
        </div>
        <div class="tab-panel ward-panel"><div class="ward-grid" role="listbox"></div></div>
      </section>
    </div>`;

	const svg = $(".ward-preview svg", el);
	const grid = $(".ward-grid", el);
	const nameEl = $(".ward-name", el);
	const starsEl = $(".ward-stars", el);
	const gaze = createGaze(svg);
	let tab = lastTab;
	let raf = 0;
	let blinkTimer: ReturnType<typeof setTimeout> | null = null;

	function renderMeta() {
		nameEl.textContent = outfitTitle(costume);
		starsEl.textContent = stars(costume);
	}

	function renderGrid(animate) {
		const cat = CATEGORIES.find((c) => c.id === tab);
		if (!cat) return;
		const items = itemsFor(tab as CostumeCategory);
		const options =
			cat.id === "finish" ? items : [{ id: null, name: "None" }, ...items];
		grid.innerHTML = options
			.map((it) => {
				const selected = (costume[cat.id] ?? null) === it.id;
				return `
        <button class="tile${selected ? " is-on" : ""}" role="option" aria-selected="${selected}" data-id="${it.id ?? ""}" title="${esc(it.name)}">
          <span class="tile-art">${thumb(cat, it.id)}</span>
          <span class="tile-name">${esc(it.name)}</span>
        </button>`;
			})
			.join("");
		$$<".tab">(".tab", el).forEach((t) => {
			t.setAttribute("aria-selected", String(t.dataset.tab === tab));
		});
		if (animate && !reducedMotion()) {
			$$(".tile", grid).forEach((t, i) => {
				t.animate(
					[
						{ opacity: 0, transform: "translateY(8px) scale(.94)" },
						{ opacity: 1, transform: "none" },
					],
					{
						duration: 240,
						delay: i * 18,
						easing: "cubic-bezier(.2,.8,.3,1)",
						fill: "backwards",
					},
				);
			});
		}
	}

	function equip(next, { random = false } = {}) {
		const prev = costume;
		costume = { ...EMPTY_COSTUME, ...next };
		applyCostume(svg, costume, prev, { uid: "wp", animate: !reducedMotion() });
		renderMeta();
		renderGrid(false);
		ctx.api.patchSettings({ costume });
		if (!reducedMotion()) {
			$(".ward-preview", el).animate(
				random
					? [
							{ transform: "scaleX(1)" },
							{ transform: "scaleX(-1)" },
							{ transform: "scaleX(1)" },
							{ transform: "scaleX(-1) translateY(-8px)" },
							{ transform: "scaleX(1)" },
						]
					: [
							{ transform: "scale(1,1)" },
							{ transform: "scale(1.06,.93)", offset: 0.3 },
							{ transform: "scale(.97,1.04)", offset: 0.6 },
							{ transform: "none" },
						],
				{ duration: random ? 560 : 420, easing: "ease-out" },
			);
		}
	}

	function randomCostume() {
		const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
		const next: Costume = { ...EMPTY_COSTUME };
		for (const c of CATEGORIES) {
			const ids = itemsFor(c.id).map((i) => i.id);
			if (c.id === "finish")
				next.finish = Math.random() < 0.45 ? pick(ids) : "silver";
			else
				next[c.id] =
					Math.random() < (c.id === "hat" ? 0.85 : 0.5) ? pick(ids) : null;
		}
		return next;
	}

	el.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const tabBtn = target.closest<HTMLElement>("[data-tab]");
		if (tabBtn) {
			const nextTab = tabBtn.dataset.tab as CostumeCategory | undefined;
			if (!nextTab || nextTab === tab) return;
			tab = lastTab = nextTab;
			sfx.hover();
			renderGrid(true);
			return;
		}
		const tile = target.closest<HTMLElement>(".tile");
		if (tile) {
			const id = tile.dataset.id || null;
			if (tab === "finish") equip({ ...costume, finish: id || "silver" });
			else equip({ ...costume, [tab]: costume[tab] === id ? null : id });
			sfx.pop();
			return;
		}
		const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
		if (act === "random") {
			equip(randomCostume(), { random: true });
			sfx.select();
		}
		if (act === "reset") {
			equip({ ...EMPTY_COSTUME });
			sfx.boop();
		}
	});

	// Preview Clippy watches your cursor too.
	let mouse: { x: number; y: number; t: number } | null = null;
	el.addEventListener("mousemove", (e) => {
		mouse = { x: e.clientX, y: e.clientY, t: performance.now() };
	});
	const loop = () => {
		if (mouse && performance.now() - mouse.t < 4000)
			gaze.lookAt(mouse.x, mouse.y);
		else gaze.lookDir(0.15, 0.1);
		gaze.tick();
		raf = requestAnimationFrame(loop);
	};
	const scheduleBlink = () => {
		blinkTimer = setTimeout(
			() => {
				blink(svg);
				scheduleBlink();
			},
			2000 + Math.random() * 3500,
		);
	};

	renderMeta();
	renderGrid(false);
	loop();
	scheduleBlink();

	return {
		onEnter() {
			renderGrid(true);
		},
		onSettings(s) {
			if (JSON.stringify(s.costume) !== JSON.stringify(costume)) {
				const prev = costume;
				costume = { ...EMPTY_COSTUME, ...s.costume };
				applyCostume(svg, costume, prev, { uid: "wp", animate: false });
				renderMeta();
				renderGrid(false);
			}
		},
		unmount() {
			cancelAnimationFrame(raf);
			clearTimeout(blinkTimer);
		},
	};
}
