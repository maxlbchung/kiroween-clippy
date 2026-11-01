// Arcade: where Clippy's mini-games will live. Empty for now — the registry is
// the extension point. A game is { id, name, blurb, color, mount(el, ctx) }.
import { icon } from '../../common/icons.js';
import { $, esc, sfx } from '../../common/ui.js';

export const GAMES = [];

const SLOTS = [
  { color: '#e5484d', label: 'Cartridge A' },
  { color: '#2f7cf6', label: 'Cartridge B' },
  { color: '#30a46c', label: 'Cartridge C' },
  { color: '#ffb224', label: 'Cartridge D' },
];

export function mount(el, ctx) {
  const cards = SLOTS.map((s, i) => {
    const game = GAMES[i];
    return `
      <button class="cart${game ? '' : ' is-locked'}" style="--cart:${game?.color || s.color};--i:${i}" ${game ? `data-game="${esc(game.id)}"` : 'aria-disabled="true"'}>
        <span class="cart-shell">
          <span class="cart-label">
            ${game ? `<b class="px">${esc(game.name)}</b>` : `<span class="cart-q px">?</span>`}
          </span>
          <span class="cart-ridges"></span>
        </span>
        <span class="cart-name px">${game ? esc(game.blurb) : 'Coming soon'}</span>
        ${game ? '' : `<span class="cart-lock">${icon('lock', 16)}</span>`}
      </button>`;
  }).join('');

  el.innerHTML = `
    <div class="arcade">
      <div class="marquee">
        <div class="marquee-lights" aria-hidden="true"></div>
        <div class="marquee-title px">CLIPPY'S ARCADE</div>
        <div class="marquee-sub px">${GAMES.length ? 'Pick a cartridge!' : 'No games installed — yet!'}</div>
      </div>
      <div class="carts">${cards}</div>
      <div class="arcade-foot">
        <span class="hint">Clippy is still reading the rulebooks. Games will show up here.</span>
        <span class="insert-coin px">INSERT COIN</span>
      </div>
    </div>`;

  el.addEventListener('click', (e) => {
    const cart = e.target.closest('.cart');
    if (!cart) return;
    if (cart.classList.contains('is-locked')) {
      sfx.boop();
      cart.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }],
        { duration: 300 },
      );
      ctx.setMood('sad');
      setTimeout(() => ctx.setMood(null), 900);
      return;
    }
    const game = GAMES.find((g) => g.id === cart.dataset.game);
    if (game) game.mount($('.arcade', el), ctx);
  });

  return {};
}
