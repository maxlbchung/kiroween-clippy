// Wardrobe: dress Clippy up. Changes save instantly and show live on the pet.
// Locked items can be tried on here, then bought with arcade credits.

import { owns, priceOf } from "../../../shared/shop.js";
import type {
	Costume,
	CostumeCategory,
	RendererContext,
	WalletSettings,
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
	let wallet: WalletSettings = ctx.settings.wallet;
	// A locked item being tried on. It is drawn but never saved.
	let preview: { category: CostumeCategory; id: string } | null = null;
	let drawn: Costume = costume;

	el.innerHTML = `
    <div class="wardrobe">
      <section class="ward-stage">
        <div class="ward-wallet px" title="Arcade credits">${icon("coin", 16)}<span></span></div>
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
        <div class="ward-buy" hidden>
          <span class="ward-price px">${icon("coin", 16)}<span></span></span>
          <button class="btn btn-sm btn-primary" data-act="buy">Buy</button>
          <button class="btn btn-sm" data-act="cancel" aria-label="Stop trying on"><span class="x-glyph"></span></button>
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
	const walletEl = $(".ward-wallet span", el);
	const actionsEl = $(".ward-actions", el);
	const buyEl = $(".ward-buy", el);
	const priceEl = $(".ward-price span", el);
	const buyBtn = $('[data-act="buy"]', el);
	const gaze = createGaze(svg);
	let tab = lastTab;
	let raf = 0;
	let blinkTimer: ReturnType<typeof setTimeout> | null = null;

	const shown = (): Costume =>
		preview ? { ...costume, [preview.category]: preview.id } : costume;

	function draw(animate: boolean) {
		const next = shown();
		applyCostume(svg, next, drawn, { uid: "wp", animate });
		drawn = next;
	}

	function renderMeta() {
		const look = shown();
		nameEl.textContent = outfitTitle(look);
		walletEl.textContent = String(wallet.credits);
		actionsEl.hidden = !!preview;
		buyEl.hidden = !preview;
		if (!preview) {
			starsEl.textContent = stars(look);
			return;
		}
		const price = priceOf(preview.category, preview.id);
		const short = price - wallet.credits;
		priceEl.textContent = String(price);
		buyBtn.toggleAttribute("disabled", short > 0);
		starsEl.textContent =
			short > 0 ? `Need ${short} more credits` : "Trying on. Buy to keep it!";
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
				const locked = !owns(wallet, cat.id, it.id);
				const trying = preview?.category === cat.id && preview.id === it.id;
				const price = priceOf(cat.id, it.id);
				const cls = `tile${selected ? " is-on" : ""}${locked ? " is-locked" : ""}${trying ? " is-preview" : ""}`;
				const label = locked ? `${it.name}: ${price} credits` : it.name;
				return `
        <button class="${cls}" role="option" aria-selected="${selected}" data-id="${it.id ?? ""}" title="${esc(label)}">
          <span class="tile-art">${thumb(cat, it.id)}</span>
          <span class="tile-name">${esc(it.name)}</span>
          ${locked ? `<span class="tile-price px">${icon("coin", 12)}${price}</span>` : ""}
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
		preview = null;
		costume = { ...EMPTY_COSTUME, ...next };
		draw(!reducedMotion());
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
			const ids = itemsFor(c.id)
				.map((i) => i.id)
				.filter((id) => owns(wallet, c.id, id));
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
			const category = tab as CostumeCategory;
			if (!owns(wallet, category, id)) {
				tryOn(category, id);
				return;
			}
			if (tab === "finish") equip({ ...costume, finish: id || "silver" });
			else equip({ ...costume, [tab]: costume[tab] === id ? null : id });
			sfx.pop();
			return;
		}
		const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
		if (act === "buy") buy();
		if (act === "cancel") {
			tryOn(preview?.category, preview?.id);
			sfx.close();
		}
		if (act === "random") {
			equip(randomCostume(), { random: true });
			sfx.select();
		}
		if (act === "reset") {
			equip({ ...EMPTY_COSTUME });
			sfx.boop();
		}
	});

	/** Toggles a try-on of a locked item; the same item again takes it off. */
	function tryOn(category: CostumeCategory, id: string) {
		const same = preview?.category === category && preview?.id === id;
		preview = same || !id ? null : { category, id };
		draw(!reducedMotion());
		renderMeta();
		renderGrid(false);
		if (!same) sfx.hover();
	}

	async function buy() {
		if (!preview) return;
		const { category, id } = preview;
		buyBtn.setAttribute("disabled", "");
		const res = await ctx.api.buyCostume(category, id);
		if ("error" in res) {
			sfx.error();
			starsEl.textContent = res.error;
			buyBtn.removeAttribute("disabled");
			return;
		}
		wallet = res.settings.wallet;
		equip({ ...costume, [category]: id });
		sfx.select();
		ctx.setMood("happy");
		setTimeout(() => ctx.setMood(null), 1000);
		if (!reducedMotion())
			$(".ward-wallet", el).animate(
				[{ transform: "scale(1.25)" }, { transform: "none" }],
				{ duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" },
			);
	}

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
			const walletChanged = JSON.stringify(s.wallet) !== JSON.stringify(wallet);
			const costumeChanged =
				JSON.stringify(s.costume) !== JSON.stringify(costume);
			wallet = s.wallet;
			if (costumeChanged) {
				costume = { ...EMPTY_COSTUME, ...s.costume };
				draw(false);
			}
			if (walletChanged || costumeChanged) {
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
