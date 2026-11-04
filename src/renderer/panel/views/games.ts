// Arcade: Clippy's mini-games. The registry is the extension point. A game is
// { id, name, blurb, color, mount(el, ctx, back) }, where `mount` replaces the
// arcade's content and `back` returns to the cartridge shelf.

import { POINTS_PER_CREDIT } from "../../../shared/shop.js";
import type { RendererContext } from "../../../shared/types.js";
import { icon } from "../../common/icons.js";
import { $, esc, sfx } from "../../common/ui.js";
import { formatScore, loadBest } from "../../games/dodge/score.js";

type Game = {
	id: string;
	name: string;
	blurb: string;
	color: string;
	mount(el: HTMLElement, ctx: RendererContext, back: () => void): unknown;
};

/** Title card for Dodge. The game itself runs in a full-screen overlay. */
function mountDodge(el: HTMLElement, ctx: RendererContext, back: () => void) {
	el.innerHTML = `
    <div class="marquee">
      <div class="marquee-lights" aria-hidden="true"></div>
      <div class="marquee-title px">DODGE!</div>
      <div class="marquee-sub px">It looks like you're trying to survive.</div>
    </div>
    <ul class="game-rules">
      <li>Clippy attacks your mouse cursor with fireballs, pop-ups, dives and worse.</li>
      <li>One hit and it's game over. Close calls earn bonus points.</li>
      <li>Every ${POINTS_PER_CREDIT} points earn a credit for unlocking costumes.</li>
      <li>Press <b>Esc</b> to pause.</li>
    </ul>
    <div class="game-foot">
      <span class="game-best px">BEST ${formatScore(loadBest())}</span>
      <span class="game-credits px" title="Spend credits in the Wardrobe">${icon("coin", 16)}${ctx.settings.wallet.credits}</span>
      <button class="btn" data-act="back">Back</button>
      <button class="btn btn-primary" data-act="play">Play</button>
    </div>`;
	el.querySelector<HTMLElement>('[data-act="play"]').focus();
	el.querySelector('[data-act="back"]').addEventListener("click", () => {
		sfx.close();
		back();
	});
	el.querySelector('[data-act="play"]').addEventListener("click", () => {
		sfx.select();
		ctx.api.launchGame("dodge");
	});
}

export const GAMES: Game[] = [
	{
		id: "dodge",
		name: "Dodge!",
		blurb: "Survive!",
		color: "#e5484d",
		mount: mountDodge,
	},
];

const SLOTS = [
	{ color: "#e5484d", label: "Cartridge A" },
	{ color: "#2f7cf6", label: "Cartridge B" },
	{ color: "#30a46c", label: "Cartridge C" },
	{ color: "#ffb224", label: "Cartridge D" },
];

export function mount(el: HTMLElement, ctx: RendererContext) {
	const render = () => {
		const cards = SLOTS.map((s, i) => {
			const game = GAMES[i];
			return `
      <button class="cart${game ? "" : " is-locked"}" style="--cart:${game?.color || s.color};--i:${i}" ${game ? `data-game="${esc(game.id)}"` : 'aria-disabled="true"'}>
        <span class="cart-shell">
          <span class="cart-label">
            ${game ? `<b class="px">${esc(game.name)}</b>` : `<span class="cart-q px">?</span>`}
          </span>
          <span class="cart-ridges"></span>
        </span>
        <span class="cart-name px">${game ? esc(game.blurb) : "Coming soon"}</span>
        ${game ? "" : `<span class="cart-lock">${icon("lock", 16)}</span>`}
      </button>`;
		}).join("");

		el.innerHTML = `
    <div class="arcade">
      <div class="marquee">
        <div class="marquee-lights" aria-hidden="true"></div>
        <div class="marquee-title px">CLIPPY'S ARCADE</div>
        <div class="marquee-sub px">${GAMES.length ? "Pick a cartridge!" : "No games installed — yet!"}</div>
      </div>
      <div class="carts">${cards}</div>
      <div class="arcade-foot">
        <span class="hint">${GAMES.length < SLOTS.length ? "More cartridges coming soon." : "Every slot is full!"}</span>
        <span class="insert-coin px">INSERT COIN</span>
      </div>
    </div>`;
	};
	render();

	el.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const cart = target.closest<HTMLElement>(".cart");
		if (!cart) return;
		if (cart.classList.contains("is-locked")) {
			sfx.boop();
			cart.animate(
				[
					{ transform: "translateX(0)" },
					{ transform: "translateX(-4px)" },
					{ transform: "translateX(4px)" },
					{ transform: "translateX(-2px)" },
					{ transform: "none" },
				],
				{ duration: 300 },
			);
			ctx.setMood("sad");
			setTimeout(() => ctx.setMood(null), 900);
			return;
		}
		const game = GAMES.find((g) => g.id === cart.dataset.game);
		if (!game) return;
		sfx.select();
		const arcade = $(".arcade", el);
		game.mount(arcade, ctx, render);
	});

	return {};
}
