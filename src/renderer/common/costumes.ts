// Costume catalog. Every item is drawn in Clippy's coordinate space
// (viewBox "0 -40 200 320"): head top ≈ (100, 34), eyes at (82,102) & (120,100),
// mustache line ≈ y 128, neck ≈ y 150. Renderers take a unique id prefix `u`
// so gradients/clips never collide when an item is drawn more than once.
import type {
	Costume,
	CostumeCategory,
	CostumeSlot,
} from "../../shared/types.js";

// Pure module (no DOM) so it can also be imported from Node scripts.

export const CATEGORIES: {
	id: CostumeCategory;
	label: string;
	slots: CostumeSlot[];
	thumb: string;
}[] = [
	{ id: "hat", label: "Hats", slots: ["hat"], thumb: "40 -56 120 116" },
	{ id: "eyewear", label: "Eyewear", slots: ["eyewear"], thumb: "54 78 94 48" },
	{
		id: "mustache",
		label: "Mustache",
		slots: ["mustache"],
		thumb: "50 112 102 62",
	},
	{
		id: "cape",
		label: "Capes",
		slots: ["back", "capeFront"],
		thumb: "20 50 160 226",
	},
	{ id: "neck", label: "Neckwear", slots: ["neck"], thumb: "58 122 86 92" },
	{ id: "finish", label: "Finish", slots: [], thumb: "0 0 76 100" },
];

export const FINISHES: Record<
	string,
	{
		name: string;
		dark: string;
		base: string;
		shade: string;
		light: string;
		glow?: string;
	}
> = {
	silver: {
		name: "Silver",
		dark: "#373c46",
		base: "#c9ced6",
		shade: "#8a929e",
		light: "#ffffff",
	},
	gold: {
		name: "Gold",
		dark: "#563a06",
		base: "#eabb4a",
		shade: "#b5831f",
		light: "#fff5c8",
	},
	copper: {
		name: "Copper",
		dark: "#4a2210",
		base: "#d58050",
		shade: "#9c4f26",
		light: "#ffd6b8",
	},
	rose: {
		name: "Rose",
		dark: "#5a2a3b",
		base: "#f3abc2",
		shade: "#c56c8b",
		light: "#fff2f7",
	},
	slime: {
		name: "Slime",
		dark: "#1d4a10",
		base: "#84e651",
		shade: "#3fa52a",
		light: "#eaffd8",
		glow: "#9dff6a",
	},
	midnight: {
		name: "Midnight",
		dark: "#07080f",
		base: "#3c4166",
		shade: "#22253c",
		light: "#a3aaff",
	},
	frost: {
		name: "Frost",
		dark: "#1b3955",
		base: "#acdaff",
		shade: "#5f9fd1",
		light: "#ffffff",
	},
	pumpkin: {
		name: "Pumpkin",
		dark: "#5a2600",
		base: "#ff9a3d",
		shade: "#d4650d",
		light: "#ffe2bf",
	},
};

const heart = (cx, cy, s) =>
	`M${cx} ${cy + s * 0.9} C${cx - s * 1.45} ${cy + s * 0.05} ${cx - s * 0.95} ${cy - s * 1.05} ${cx} ${cy - s * 0.38} ` +
	`C${cx + s * 0.95} ${cy - s * 1.05} ${cx + s * 1.45} ${cy + s * 0.05} ${cx} ${cy + s * 0.9} Z`;

const star4 = (x, y, r, fill = "#ffe066") =>
	`<path d="M${x} ${y - r} Q${x + r * 0.22} ${y - r * 0.22} ${x + r} ${y} Q${x + r * 0.22} ${y + r * 0.22} ${x} ${y + r} Q${x - r * 0.22} ${y + r * 0.22} ${x - r} ${y} Q${x - r * 0.22} ${y - r * 0.22} ${x} ${y - r} Z" fill="${fill}"/>`;

function pixels(rows, x0, y0, size, colors) {
	let out = "";
	rows.forEach((row, ry) => {
		let rx = 0;
		while (rx < row.length) {
			const ch = row[rx];
			let run = 1;
			while (rx + run < row.length && row[rx + run] === ch) run++;
			if (colors[ch])
				out += `<rect x="${x0 + rx * size}" y="${y0 + ry * size}" width="${run * size}" height="${size}" fill="${colors[ch]}"/>`;
			rx += run;
		}
	});
	return `<g shape-rendering="crispEdges">${out}</g>`;
}

const CAPE_BODY =
	"M66 110 C56 150 44 200 36 256 C50 264 62 254 76 262 C90 270 110 270 124 262 C138 254 150 264 164 256 C156 200 144 150 134 110 C120 103 80 103 66 110 Z";

const clasps = (fill, stroke) =>
	`<circle cx="66" cy="112" r="6.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
	`<circle cx="134" cy="112" r="6.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
	`<circle cx="64.5" cy="110.5" r="2" fill="#fff" opacity=".7"/><circle cx="132.5" cy="110.5" r="2" fill="#fff" opacity=".7"/>`;

export const ITEMS: {
	id: string;
	category: Exclude<CostumeCategory, "finish">;
	name: string;
	parts: Partial<Record<CostumeSlot, (uid: string) => string>>;
}[] = [
	// ───────────────────────────── Hats ─────────────────────────────
	{
		id: "tophat",
		category: "hat",
		name: "Top Hat",
		parts: {
			hat: () => `
        <ellipse cx="100" cy="46" rx="46" ry="9" fill="#23232b" stroke="#0e0e12" stroke-width="2.5"/>
        <path d="M75 46 L77 -8 Q100 -13 123 -8 L125 46 Q100 51 75 46 Z" fill="#2d2d38" stroke="#0e0e12" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M75.6 30 Q100 35 124.4 30 L125 44 Q100 49 75 44 Z" fill="#c0392b" stroke="#0e0e12" stroke-width="2"/>
        <ellipse cx="100" cy="-8" rx="23" ry="5" fill="#3c3c4a" stroke="#0e0e12" stroke-width="2.5"/>
        <path d="M84 -1 L83.3 25" stroke="#5d5d72" stroke-width="4" stroke-linecap="round"/>
        <path d="M54 46 Q100 64 146 46 Q100 55 54 46 Z" fill="#3a3a47" stroke="#0e0e12" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "witch",
		category: "hat",
		name: "Witch Hat",
		parts: {
			hat: () => `
        <ellipse cx="100" cy="46" rx="56" ry="10" fill="#21182f" stroke="#0d0812" stroke-width="2.5"/>
        <path d="M76 46 C82 22 88 0 94 -16 C98 -28 92 -40 74 -48 C92 -50 107 -38 111 -22 C116 0 120 24 124 46 Q100 52 76 46 Z" fill="#35264d" stroke="#0d0812" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M95 -14 C97 -24 94 -32 86 -38" stroke="#4d3a6b" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M79 31 Q100 36 121 31 L123 42 Q100 47 77 42 Z" fill="#ff8a1f" stroke="#0d0812" stroke-width="2"/>
        <rect x="94" y="31.5" width="12" height="11" rx="1.5" fill="none" stroke="#ffd166" stroke-width="2.5"/>
        <path d="M44 46 Q100 69 156 46 Q100 58 44 46 Z" fill="#3b2b55" stroke="#0d0812" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "wizard",
		category: "hat",
		name: "Wizard Hat",
		parts: {
			hat: () => `
        <ellipse cx="100" cy="46" rx="48" ry="9" fill="#24307a" stroke="#0c1033" stroke-width="2.5"/>
        <path d="M74 46 C82 18 92 -12 106 -36 C110 -43 118 -47 127 -42 C117 -38 113 -28 113 -16 C114 6 121 28 126 46 Q100 52 74 46 Z" fill="#3547b8" stroke="#0c1033" stroke-width="2.5" stroke-linejoin="round"/>
        ${star4(98, 8, 5.5)}${star4(112, 28, 4)}${star4(106, -14, 3.5)}
        <path d="M86 30 A7 7 0 1 0 92 40 A5.5 5.5 0 1 1 86 30 Z" fill="#ffe066"/>
        <path d="M52 46 Q100 64 148 46 Q100 55 52 46 Z" fill="#3e51c4" stroke="#0c1033" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "party",
		category: "hat",
		name: "Party Hat",
		parts: {
			hat: () => `
        <path d="M100 -34 L127 46 Q100 54 73 46 Z" fill="#4ea6ff" stroke="#10213d" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M100 -34 L107 46" stroke="#7cc0ff" stroke-width="3" opacity=".7"/>
        <circle cx="96" cy="0" r="3.5" fill="#ffd23f"/><circle cx="106" cy="18" r="3.5" fill="#ff4fa3"/>
        <circle cx="90" cy="31" r="3.5" fill="#ffd23f"/><circle cx="112" cy="37" r="3.5" fill="#fff"/>
        <circle cx="101" cy="-14" r="2.8" fill="#fff"/>
        <path d="M73 46 Q100 54 127 46" stroke="#ffd23f" stroke-width="4" fill="none" stroke-dasharray="5 4" stroke-linecap="round"/>
        <g class="cos-wobble"><circle cx="100" cy="-37" r="7.5" fill="#ff4fa3" stroke="#10213d" stroke-width="2.5"/><circle cx="97.5" cy="-39.5" r="2.3" fill="#fff" opacity=".7"/></g>`,
		},
	},
	{
		id: "cowboy",
		category: "hat",
		name: "Cowboy Hat",
		parts: {
			hat: () => `
        <path d="M44 40 C52 54 72 55 100 55 C128 55 148 54 156 40 C160 33 151 29 147 36 C140 45 120 47 100 47 C80 47 60 45 53 36 C49 29 40 33 44 40 Z" fill="#a1622c" stroke="#3b2210" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M76 45 C74 26 74 8 80 0 C86 -4 94 4 100 2 C106 4 114 -4 120 0 C126 8 126 26 124 45 Q100 49 76 45 Z" fill="#b9743b" stroke="#3b2210" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M76.4 34 Q100 38 123.6 34 L124 43 Q100 47 76 43 Z" fill="#5b3418"/>
        <path d="M100 5 L100 26" stroke="#8f5527" stroke-width="3" stroke-linecap="round"/>
        <path d="M83 8 L82 28" stroke="#d1914f" stroke-width="3" stroke-linecap="round" opacity=".8"/>`,
		},
	},
	{
		id: "crown",
		category: "hat",
		name: "Crown",
		parts: {
			hat: () => `
        <path d="M70 46 L68 6 L84 22 L100 -4 L116 22 L132 6 L130 46 Q100 52 70 46 Z" fill="#ffc83d" stroke="#6b4a00" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M69.4 34 Q100 40 130.6 34 L130 46 Q100 52 70 46 Z" fill="#f0a500" stroke="#6b4a00" stroke-width="2"/>
        <circle cx="100" cy="41" r="4.5" fill="#e63946" stroke="#6b4a00" stroke-width="1.5"/>
        <circle cx="83" cy="40" r="3.2" fill="#4cc9f0" stroke="#6b4a00" stroke-width="1.5"/>
        <circle cx="117" cy="40" r="3.2" fill="#4cc9f0" stroke="#6b4a00" stroke-width="1.5"/>
        <circle cx="68" cy="5" r="3.5" fill="#fff3b0" stroke="#6b4a00" stroke-width="1.5"/>
        <circle cx="100" cy="-5" r="3.5" fill="#fff3b0" stroke="#6b4a00" stroke-width="1.5"/>
        <circle cx="132" cy="5" r="3.5" fill="#fff3b0" stroke="#6b4a00" stroke-width="1.5"/>
        <path d="M75 15 L75 30" stroke="#fff3b0" stroke-width="3" stroke-linecap="round" opacity=".85"/>`,
		},
	},
	{
		id: "propeller",
		category: "hat",
		name: "Propeller Cap",
		parts: {
			hat: () => `
        <path d="M100 47 C120 47 140 45 152 51 C141 58 116 56 100 53 Z" fill="#2f6fe0" stroke="#14213d" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M68 49 C68 20 84 6 100 6 C116 6 132 20 132 49 Q100 55 68 49 Z" fill="#e63946" stroke="#14213d" stroke-width="2.5"/>
        <path d="M100 6 C93 14 90 30 90 52 L110 52 C110 30 107 14 100 6 Z" fill="#ffd23f"/>
        <path d="M68 49 C68 20 84 6 100 6 C116 6 132 20 132 49 Q100 55 68 49 Z" fill="none" stroke="#14213d" stroke-width="2.5"/>
        <rect x="98" y="-6" width="4" height="13" fill="#666" stroke="#222" stroke-width="1.5"/>
        <g class="cos-spin"><ellipse cx="88" cy="-7" rx="13" ry="3.6" fill="#ffd23f" stroke="#222" stroke-width="1.5"/><ellipse cx="112" cy="-7" rx="13" ry="3.6" fill="#2f6fe0" stroke="#222" stroke-width="1.5"/></g>
        <circle cx="100" cy="-7" r="3.2" fill="#e63946" stroke="#222" stroke-width="1.5"/>`,
		},
	},
	{
		id: "pumpkin",
		category: "hat",
		name: "Jack-o’-Hat",
		parts: {
			hat: () => `
        <path d="M100 0 C82 -2 61 6 61 27 C61 45 80 53 100 53 C120 53 139 45 139 27 C139 6 118 -2 100 0 Z" fill="#ff8a1f" stroke="#5c2a00" stroke-width="2.5"/>
        <path d="M100 1 C90 10 88 40 100 52 M100 1 C110 10 112 40 100 52 M81 4 C70 16 72 40 85 50 M119 4 C130 16 128 40 115 50" fill="none" stroke="#d9690b" stroke-width="2.5"/>
        <path d="M97 2 C96 -8 98 -14 106 -18 L108.5 -14 C103 -10 103 -4 104 2 Z" fill="#4f7a28" stroke="#22380f" stroke-width="2" stroke-linejoin="round"/>
        <path d="M106 -6 C114 -12 123 -6 118 0" fill="none" stroke="#4f7a28" stroke-width="2.5" stroke-linecap="round"/>
        <g class="cos-glow" fill="#ffe08a" stroke="#7a3500" stroke-width="1.5" stroke-linejoin="round">
          <path d="M80 18 L88 29 L73 29 Z"/><path d="M120 18 L127 29 L112 29 Z"/>
          <path d="M77 36 L85 34 L89 40 L95 35 L100 41 L105 35 L111 40 L115 34 L123 36 C117 47 83 47 77 36 Z"/>
        </g>`,
		},
	},
	{
		id: "horns",
		category: "hat",
		name: "Devil Horns",
		parts: {
			hat: () => `
        <path d="M74 54 C64 42 62 28 69 14 C71 28 78 37 87 43 Z" fill="#d62828" stroke="#4a0a0a" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M126 54 C136 42 138 28 131 14 C129 28 122 37 113 43 Z" fill="#d62828" stroke="#4a0a0a" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M70 22 C70 32 75 39 80 42" stroke="#ff7b7b" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M130 22 C130 32 125 39 120 42" stroke="#ff7b7b" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
		},
	},
	{
		id: "halo",
		category: "hat",
		name: "Halo",
		parts: {
			hat: () => `
        <g class="cos-float">
          <ellipse cx="100" cy="12" rx="30" ry="8" fill="none" stroke="#ffe066" stroke-width="10" opacity=".28"/>
          <ellipse cx="100" cy="12" rx="29" ry="7.5" fill="none" stroke="#ffd23f" stroke-width="5"/>
          <ellipse cx="100" cy="11" rx="29" ry="7.5" fill="none" stroke="#fff8d6" stroke-width="1.6"/>
        </g>`,
		},
	},

	// ─────────────────────────── Eyewear ────────────────────────────
	{
		id: "specs",
		category: "eyewear",
		name: "Round Specs",
		parts: {
			eyewear: () => `
        <g fill="rgba(200,230,255,.16)" stroke="#5a3a1a" stroke-width="3">
          <circle cx="82" cy="102" r="18"/><circle cx="120" cy="100" r="18"/>
        </g>
        <path d="M99 96 Q101 91 103 95" fill="none" stroke="#5a3a1a" stroke-width="3" stroke-linecap="round"/>
        <path d="M64 99 L57 95 M138 97 L145 93" stroke="#5a3a1a" stroke-width="3" stroke-linecap="round"/>
        <path d="M72 92 Q76 88 82 88 M110 90 Q114 86 120 86" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`,
		},
	},
	{
		id: "shades",
		category: "eyewear",
		name: "Shades",
		parts: {
			eyewear: (u) => `
        <defs><linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3b3f55"/><stop offset=".5" stop-color="#11121a"/><stop offset="1" stop-color="#262a3d"/>
        </linearGradient></defs>
        <path d="M60 92 L142 88" stroke="#0b0b10" stroke-width="4" stroke-linecap="round"/>
        <path d="M63 91 L101 91 L99 107 C97 117 69 117 66 107 Z" fill="url(#${u}-sh)" stroke="#0b0b10" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M101 89 L139 88 L137 104 C135 114 107 114 104 104 Z" fill="url(#${u}-sh)" stroke="#0b0b10" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M70 96 L78 96 M108 94 L116 94" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>`,
		},
	},
	{
		id: "pixel",
		category: "eyewear",
		name: "Pixel Shades",
		parts: {
			eyewear: () =>
				pixels(
					[
						"kkkkkkkkkkkkkkkkkkkkk",
						".kwwkkkkk...kwwkkkkk.",
						".kkwkkkkk...kkwkkkkk.",
						"..kkkkkk.....kkkkkk..",
					],
					59,
					90,
					4,
					{ k: "#0b0b10", w: "#ffffff" },
				),
		},
	},
	{
		id: "monocle",
		category: "eyewear",
		name: "Monocle",
		parts: {
			eyewear: () => `
        <circle cx="120" cy="100" r="18" fill="rgba(220,240,255,.16)" stroke="#c9a227" stroke-width="3.5"/>
        <circle cx="120" cy="100" r="18" fill="none" stroke="#fff3b0" stroke-width="1" opacity=".7"/>
        <path d="M134 112 C143 130 137 150 128 168" fill="none" stroke="#c9a227" stroke-width="2" stroke-dasharray="3 2.4" stroke-linecap="round"/>
        <path d="M109 91 Q113 86 120 86" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".8"/>`,
		},
	},
	{
		id: "nerd",
		category: "eyewear",
		name: "Nerd Frames",
		parts: {
			eyewear: () => `
        <rect x="63" y="89" width="38" height="28" rx="7" fill="rgba(200,230,255,.14)" stroke="#111" stroke-width="5"/>
        <rect x="101" y="87" width="38" height="28" rx="7" fill="rgba(200,230,255,.14)" stroke="#111" stroke-width="5"/>
        <rect x="96" y="94" width="10" height="9" rx="1" fill="#f4f1e1" stroke="#9a9a9a" stroke-width="1"/>
        <path d="M97 97 L105 97 M97 100 L105 100" stroke="#c7c2a8" stroke-width="1"/>
        <path d="M70 95 L76 95 M108 93 L114 93" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`,
		},
	},
	{
		id: "3d",
		category: "eyewear",
		name: "3D Glasses",
		parts: {
			eyewear: () => `
        <rect x="63" y="90" width="37" height="24" rx="3" fill="none" stroke="#2a2a2a" stroke-width="7"/>
        <rect x="102" y="88" width="37" height="24" rx="3" fill="none" stroke="#2a2a2a" stroke-width="7"/>
        <rect x="63" y="90" width="37" height="24" rx="3" fill="rgba(235,50,70,.58)" stroke="#f7f7f2" stroke-width="4.5"/>
        <rect x="102" y="88" width="37" height="24" rx="3" fill="rgba(0,200,255,.52)" stroke="#f7f7f2" stroke-width="4.5"/>
        <path d="M100 98 L102 97" stroke="#f7f7f2" stroke-width="5"/>`,
		},
	},
	{
		id: "hearts",
		category: "eyewear",
		name: "Heart Glasses",
		parts: {
			eyewear: () => `
        <path d="${heart(82, 103, 17)}" fill="rgba(255,90,160,.78)" stroke="#b0124f" stroke-width="3" stroke-linejoin="round"/>
        <path d="${heart(120, 101, 17)}" fill="rgba(255,90,160,.78)" stroke="#b0124f" stroke-width="3" stroke-linejoin="round"/>
        <path d="M99 96 Q101 92 103 95" fill="none" stroke="#b0124f" stroke-width="3" stroke-linecap="round"/>
        <path d="M70 94 Q73 90 77 91 M108 92 Q111 88 115 89" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".85"/>`,
		},
	},

	// ─────────────────────────── Mustache ───────────────────────────
	{
		id: "classic",
		category: "mustache",
		name: "Classic",
		parts: {
			mustache: () => `
        <path d="M101 124 C94 119 84 119 76 125 C72 128 70 134 74 136 C80 132 90 134 101 131 C112 134 122 132 128 136 C132 134 130 128 126 125 C118 119 108 119 101 124 Z" fill="#4a2c17" stroke="#22130a" stroke-width="2" stroke-linejoin="round"/>
        <path d="M84 124 Q90 122 96 124" stroke="#6e4527" stroke-width="2" fill="none" stroke-linecap="round"/>`,
		},
	},
	{
		id: "handlebar",
		category: "mustache",
		name: "Handlebar",
		parts: {
			mustache: () => `
        <path d="M101 125 C92 119 80 122 72 130 C66 135 58 134 56 128 C55 124 58 121 61 123 C60 126 62 128 65 127 C72 124 80 133 101 132 C122 133 130 124 137 127 C140 128 142 126 141 123 C144 121 147 124 146 128 C144 134 136 135 130 130 C122 122 110 119 101 125 Z" fill="#2b1a0e" stroke="#120a04" stroke-width="2" stroke-linejoin="round"/>
        <path d="M84 125 Q92 123 97 125" stroke="#5a3a20" stroke-width="2" fill="none" stroke-linecap="round"/>`,
		},
	},
	{
		id: "pencil",
		category: "mustache",
		name: "Pencil",
		parts: {
			mustache: () => `
        <path d="M78 129 Q90 123 99 126 L99 129 Q90 127 78 129 Z M103 126 Q112 123 124 129 Q112 127 103 129 Z" fill="#2b1a0e" stroke="#120a04" stroke-width="2.2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "walrus",
		category: "mustache",
		name: "Walrus",
		parts: {
			mustache: () => `
        <path d="M70 124 C76 116 92 116 101 121 C110 116 126 116 132 124 C136 132 134 142 130 146 L126 138 L122 147 L117 139 L112 148 L107 140 L101 149 L95 140 L90 148 L85 139 L80 147 L76 138 L72 146 C68 142 66 132 70 124 Z" fill="#7a4b2a" stroke="#2e1a0c" stroke-width="2" stroke-linejoin="round"/>
        <path d="M80 124 Q88 121 95 124 M107 124 Q114 121 122 124" stroke="#a06a42" stroke-width="2" fill="none" stroke-linecap="round"/>`,
		},
	},
	{
		id: "droopy",
		category: "mustache",
		name: "Droopy",
		parts: {
			mustache: () => `
        <path d="M101 123 C90 118 78 120 74 126 C69 134 67 150 66 164 C66 168 71 168 71 164 C72 152 75 140 80 134 C88 130 96 131 101 132 C106 131 114 130 122 134 C127 140 130 152 131 164 C131 168 136 168 136 164 C135 150 133 134 128 126 C124 120 112 118 101 123 Z" fill="#3a2414" stroke="#160d06" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},

	// ──────────────────────────── Capes ─────────────────────────────
	{
		id: "hero",
		category: "cape",
		name: "Hero Cape",
		parts: {
			back: () => `
        <g class="cos-cape">
          <path d="${CAPE_BODY}" fill="#d62828" stroke="#5a0b0b" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M84 120 C80 170 74 220 70 258 M116 120 C120 170 126 220 130 258" stroke="#a51d1d" stroke-width="3" fill="none" opacity=".75"/>
          <path d="M100 114 L100 266" stroke="#ff5a5a" stroke-width="2" opacity=".35"/>
        </g>`,
			capeFront: () => clasps("#ffd23f", "#7a5a00"),
		},
	},
	{
		id: "vampire",
		category: "cape",
		name: "Vampire Cape",
		parts: {
			back: () => `
        <g class="cos-cape">
          <path d="M66 110 C52 150 36 210 28 262 L46 252 L60 266 L80 254 L100 268 L120 254 L140 266 L154 252 L172 262 C164 210 148 150 134 110 C120 103 80 103 66 110 Z" fill="#15101b" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M73 115 C63 152 52 202 46 246 L60 256 L80 246 L100 258 L120 246 L140 256 L154 246 C148 202 137 152 127 115 Z" fill="#8f1027"/>
        </g>
        <path d="M64 118 C52 100 44 80 40 56 C54 68 64 77 76 84 Z" fill="#8f1027" stroke="#12060a" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M136 118 C148 100 156 80 160 56 C146 68 136 77 124 84 Z" fill="#8f1027" stroke="#12060a" stroke-width="2.5" stroke-linejoin="round"/>`,
			capeFront: () => clasps("#c1121f", "#ffd23f"),
		},
	},
	{
		id: "royal",
		category: "cape",
		name: "Royal Robe",
		parts: {
			back: () => `
        <g class="cos-cape">
          <path d="${CAPE_BODY}" fill="#6a2c91" stroke="#2a0f3d" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M84 122 C80 170 74 220 70 256 M116 122 C120 170 126 220 130 256" stroke="#55207a" stroke-width="3" fill="none"/>
          <path d="M40 254 C70 268 130 268 160 254" stroke="#fbfbf5" stroke-width="10" fill="none" stroke-linecap="round"/>
          <path d="M60 261 l2 5 l2 -5 z M86 265 l2 5 l2 -5 z M112 265 l2 5 l2 -5 z M138 261 l2 5 l2 -5 z" fill="#111"/>
        </g>
        <path d="M58 108 C70 97 130 97 142 108 C146 116 140 123 134 120 C120 112 80 112 66 120 C60 123 54 116 58 108 Z" fill="#fbfbf5" stroke="#9a9a9a" stroke-width="2"/>
        <path d="M70 108 l2 5 l2 -5 z M92 104 l2 5 l2 -5 z M108 104 l2 5 l2 -5 z M128 108 l2 5 l2 -5 z" fill="#111"/>`,
			capeFront: () => clasps("#ffd23f", "#6b4a00"),
		},
	},
	{
		id: "spectral",
		category: "cape",
		name: "Spectral Cloak",
		parts: {
			back: (u) => `
        <defs><linearGradient id="${u}-sp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b8fff0" stop-opacity=".95"/><stop offset="1" stop-color="#6be2ff" stop-opacity=".25"/>
        </linearGradient></defs>
        <g class="cos-cape cos-glow">
          <path d="M66 110 C56 150 44 200 36 252 C44 262 52 248 62 258 C72 268 80 252 90 262 C98 270 104 254 112 262 C122 270 128 254 138 260 C148 266 154 252 164 254 C156 200 144 150 134 110 C120 103 80 103 66 110 Z" fill="url(#${u}-sp)" stroke="#7ff5dc" stroke-width="2"/>
          <path d="M84 124 C80 170 76 210 74 246 M116 124 C120 170 124 210 126 246" stroke="#ffffff" stroke-width="2" fill="none" opacity=".45"/>
        </g>`,
			capeFront: () => clasps("#7ff5dc", "#1d6b5d"),
		},
	},

	// ─────────────────────────── Neckwear ───────────────────────────
	{
		id: "bowtie",
		category: "neck",
		name: "Bow Tie",
		parts: {
			neck: () => `
        <path d="M101 150 L81 139 C76 146 76 155 81 161 Z" fill="#d62828" stroke="#4a0a0a" stroke-width="2" stroke-linejoin="round"/>
        <path d="M101 150 L121 139 C126 146 126 155 121 161 Z" fill="#d62828" stroke="#4a0a0a" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="86" cy="146" r="1.8" fill="#fff"/><circle cx="85" cy="154" r="1.8" fill="#fff"/><circle cx="116" cy="146" r="1.8" fill="#fff"/><circle cx="117" cy="154" r="1.8" fill="#fff"/>
        <rect x="95.5" y="144.5" width="11" height="11" rx="3" fill="#b51d1d" stroke="#4a0a0a" stroke-width="2"/>`,
		},
	},
	{
		id: "necktie",
		category: "neck",
		name: "Necktie",
		parts: {
			neck: (u) => `
        <defs><clipPath id="${u}-tie"><path d="M97 152 L105 152 L112 204 L101 216 L90 204 Z"/></clipPath></defs>
        <path d="M95 142 L86 136 L90 148 Z M107 142 L116 136 L112 148 Z" fill="#fff" stroke="#888" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M97 152 L105 152 L112 204 L101 216 L90 204 Z" fill="#2563eb" stroke="#0b1f5c" stroke-width="2" stroke-linejoin="round"/>
        <g clip-path="url(#${u}-tie)" stroke="#93c5fd" stroke-width="3.5"><path d="M88 168 L114 156 M88 184 L114 172 M88 200 L114 188 M88 216 L114 204"/></g>
        <path d="M97 152 L105 152 L112 204 L101 216 L90 204 Z" fill="none" stroke="#0b1f5c" stroke-width="2" stroke-linejoin="round"/>
        <path d="M95 142 L107 142 L105 152 L97 152 Z" fill="#1d4ed8" stroke="#0b1f5c" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "scarf",
		category: "neck",
		name: "Cozy Scarf",
		parts: {
			neck: (u) => `
        <defs><pattern id="${u}-sc" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#e63946"/><rect width="6" height="12" fill="#f1faee"/>
        </pattern></defs>
        <path d="M116 146 L131 145 L136 194 L121 197 Z" fill="url(#${u}-sc)" stroke="#5a0b14" stroke-width="2" stroke-linejoin="round"/>
        <path d="M121 197 L120 203 M125 196 L125 202 M129 195 L130 201 M133 195 L135 200" stroke="#e63946" stroke-width="2" stroke-linecap="round"/>
        <path d="M63 132 C80 141 122 141 139 132 L139 147 C122 156 80 156 63 147 Z" fill="url(#${u}-sc)" stroke="#5a0b14" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "bandana",
		category: "neck",
		name: "Bandana",
		parts: {
			neck: () => `
        <path d="M66 135 C84 144 118 144 136 135 L101 178 Z" fill="#ff8a1f" stroke="#6b3200" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="92" cy="146" r="2" fill="#fff4e0"/><circle cx="110" cy="146" r="2" fill="#fff4e0"/><circle cx="101" cy="158" r="2" fill="#fff4e0"/><circle cx="86" cy="140" r="1.6" fill="#fff4e0"/><circle cx="116" cy="140" r="1.6" fill="#fff4e0"/>
        <path d="M66 135 L58 132 L60 141 Z M136 135 L144 132 L142 141 Z" fill="#e8730f" stroke="#6b3200" stroke-width="2" stroke-linejoin="round"/>`,
		},
	},
	{
		id: "medal",
		category: "neck",
		name: "Gold Medal",
		parts: {
			neck: () => `
        <path d="M86 128 L98 160 L104 160 L92 128 Z" fill="#2f6fe0" stroke="#14213d" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M116 128 L104 160 L98 160 L110 128 Z" fill="#e63946" stroke="#4a0a0a" stroke-width="1.8" stroke-linejoin="round"/>
        <g class="cos-swing">
          <circle cx="101" cy="170" r="11" fill="#ffc83d" stroke="#6b4a00" stroke-width="2.5"/>
          <circle cx="101" cy="170" r="7" fill="none" stroke="#e0a100" stroke-width="1.5"/>
          ${star4(101, 170, 5, "#fff3b0")}
        </g>`,
		},
	},
];

export const ITEM_BY_ID: Record<string, (typeof ITEMS)[number]> =
	Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function itemsFor(category: CostumeCategory) {
	if (category === "finish")
		return Object.entries(FINISHES).map(([id, f]) => ({
			id,
			category,
			name: f.name,
		}));
	return ITEMS.filter((i) => i.category === category);
}

/** Markup for all slots an item fills, keyed by slot name. */
export function itemParts(
	itemId: string,
	u: string,
): Partial<Record<CostumeSlot, string>> {
	const item = ITEM_BY_ID[itemId];
	if (!item) return {};
	return Object.fromEntries(
		Object.entries(item.parts).map(([slot, fn]) => [slot, fn(u)]),
	);
}

export function finishSwatch(id: string) {
	const f = FINISHES[id] || FINISHES.silver;
	const d =
		"M30 74 L30 30 A13 13 0 0 1 56 30 L56 82 A19 19 0 0 1 18 82 L18 22 A21 21 0 0 1 60 22";
	return `
    <path d="${d}" fill="none" stroke="${f.dark}" stroke-width="10" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${f.base}" stroke-width="6.5" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${f.light}" stroke-width="2" stroke-linecap="round" transform="translate(-1.3 -1.3)" opacity=".85"/>`;
}

export const EMPTY_COSTUME: Costume = {
	hat: null,
	eyewear: null,
	mustache: null,
	cape: null,
	neck: null,
	finish: "silver",
};
