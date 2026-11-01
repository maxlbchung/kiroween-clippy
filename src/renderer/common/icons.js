// 16×16 pixel-art icons rendered as crisp SVG. Palette letters:
// k ink, w white, s soft shade, a accent (currentColor), d dark, g grey,
// r red, y yellow, o orange, b blue, p pink, n green.
const PALETTE = {
  k: '#17171c', w: '#ffffff', s: '#cfd3dd', a: 'currentColor', d: '#2e2e38', g: '#7d808c',
  r: '#e5484d', y: '#ffd23f', o: '#ff8a1f', b: '#2f7cf6', p: '#ff6fae', n: '#30a46c',
};

function gear() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const r = Math.hypot(dx, dy);
      const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI / 4);
      const tooth = Math.abs(a - Math.PI / 8) < 0.26;
      const inside = (r < 5.3 || (tooth && r < 7.6)) && r >= 2.1;
      row += inside ? 'x' : '.';
    }
    rows.push(row);
  }
  // outline pass
  const at = (x, y) => (rows[y] && rows[y][x]) || '.';
  return rows.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== 'x') return '.';
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => at(x + ox, y + oy) !== 'x');
      if (edge) return 'k';
      return x + y < 14 ? 'w' : 's';
    }).join(''),
  );
}

export const ICONS = {
  chat: [
    '................',
    '...kkkkkkkkkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwaawaawaawsk.',
    '.kwwaawaawaawsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwwwwwwssk.',
    '..kwwwwwwwwssk..',
    '...kwwkkkkkkk...',
    '...kwwk.........',
    '...kwk..........',
    '...kk...........',
    '................',
  ],
  direct: [
    '................',
    '......kkkk......',
    '.....kwaaak.....',
    '.....kwaaak.....',
    '.....kwaaak.....',
    '.....kwaaak.....',
    '.....kwaaak.....',
    '...k.kaaaak.k...',
    '...k..kkkk..k...',
    '...kk......kk...',
    '....kk....kk....',
    '......kkkk......',
    '.......kk.......',
    '.......kk.......',
    '.....kkkkkk.....',
    '................',
  ],
  games: [
    '................',
    '......kkkk......',
    '.....kaawak.....',
    '.....kaaaak.....',
    '......kkkk......',
    '.......kk.......',
    '.......kk.......',
    '.......kk.......',
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwkkwwwwwwrrsk.',
    '.kwkkwwwwwwrrsk.',
    '.kssssssssssssk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  customize: [
    '................',
    '..............y.',
    '....kkkkkkkk.yyy',
    '....kdgddddk..y.',
    '....kdgddddk....',
    '....kdgddddk....',
    '....kdgddddk....',
    '....kaaaaaak....',
    '....kdgddddk....',
    '..kkkkkkkkkkkk..',
    '.kddddddddddddk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
  ],
  settings: gear(),
  send: [
    '................',
    '................',
    '..kk............',
    '..kwkk..........',
    '..kwwwkk........',
    '..kwwwwwkk......',
    '..kwwwwwwwkk....',
    '..kaaaaaaaaakk..',
    '..kwwwwwwwkk....',
    '..kwwwwwkk......',
    '..kwwwkk........',
    '..kwkk..........',
    '..kk............',
    '................',
    '................',
    '................',
  ],
  dice: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwsk.',
    '.kwkkwwwwwwwwsk.',
    '.kwkkwwwwwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwkkwwwwsk.',
    '.kwwwwwkkwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwwwwwkksk.',
    '.kwwwwwwwwwkksk.',
    '.kwwwwwwwwwwwsk.',
    '.kssssssssssssk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  reset: [
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwkkkkkkwwk..',
    '.kwwk......kwwk.',
    '.kwk........kwk.',
    'kkkkk.......kwk.',
    '.kwk........kwk.',
    '..k.........kwk.',
    '............kwk.',
    '.kwk.......kwwk.',
    '..kwwk...kkwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ],
  lock: [
    '................',
    '.....kkkkkk.....',
    '....kwwwwwwk....',
    '...kwkkkkkkwk...',
    '...kwk....kwk...',
    '...kwk....kwk...',
    '..kkkkkkkkkkkk..',
    '..kyyyyyyyyyok..',
    '..kyyyykkyyyok..',
    '..kyyyykkyyyok..',
    '..kyyyyykyyyok..',
    '..kyyyyyyyyyok..',
    '..kooooooooook..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  key: [
    '................',
    '................',
    '..kkkk..........',
    '.kyyyyk.........',
    'kyykkyyk........',
    'kykwwkyk........',
    'kykwwkykkkkkkkk.',
    'kyykkyyyyyyyyyyk',
    '.kyyyyokkokkkokk',
    '..kkkkk.k.kk.k..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  speaker: [
    '................',
    '.......kk.......',
    '......kwk...k...',
    '.....kwwk....k..',
    '.kkkkwwwk.k...k.',
    '.kwwwwwwk..k..k.',
    '.kwwwwwwk..k..k.',
    '.kwwwwwwk..k..k.',
    '.kwwwwwwk..k..k.',
    '.kkkkwwwk.k...k.',
    '.....kwwk....k..',
    '......kwk...k...',
    '.......kk.......',
    '................',
    '................',
    '................',
  ],
  monitor: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kssssssssssssk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbwbbbbbbbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.kssssssssssssk.',
    '.kkkkkkkkkkkkkk.',
    '......kssk......',
    '....kkkkkkkk....',
    '................',
    '................',
    '................',
  ],
  info: [
    '................',
    '.....kkkkkk.....',
    '...kkbbbbbbkk...',
    '..kbbbbwwbbbbk..',
    '..kbbbbwwbbbbk..',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbwwwbbbbbk.',
    '.kbbbbbwwbbbbbk.',
    '.kbbbbbwwbbbbbk.',
    '.kbbbbbwwbbbbbk.',
    '..kbbbwwwwbbbk..',
    '..kbbbbbbbbbbk..',
    '...kkbbbbbbkk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ],
  check: [
    '................',
    '................',
    '................',
    '............kk..',
    '...........knk..',
    '..........knnk..',
    '..kk.....knnk...',
    '..knk...knnk....',
    '..knnk.knnk.....',
    '...knnknnk......',
    '....knnnk.......',
    '.....knk........',
    '......k.........',
    '................',
    '................',
    '................',
  ],
  none: [
    '................',
    '.....kkkkkk.....',
    '...kkggggggkk...',
    '..kgg......kgk..',
    '..kg......kkgk..',
    '.kg......kgk.gk.',
    '.kg.....kgk..gk.',
    '.kg....kgk...gk.',
    '.kg...kgk....gk.',
    '.kg..kgk.....gk.',
    '.kg.kgk......gk.',
    '..kgkk......gk..',
    '..kgk......ggk..',
    '...kkggggggkk...',
    '.....kkkkkk.....',
    '................',
  ],
};

/** SVG string for a pixel icon. `size` in px; accent follows CSS `color`. */
export function icon(name, size = 32) {
  const rows = ICONS[name];
  if (!rows) return '';
  let rects = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      const fill = PALETTE[ch];
      if (fill) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`;
      x += run;
    }
  });
  return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
