// Renders Clippy into app/tray icons using Electron's offscreen renderer.
// Usage: npm run icons   (writes build/icon.png, build/icon.ico, src/renderer/assets/icons/*)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import pngToIco from "png-to-ico";
import { clippyMarkup } from "../src/renderer/common/clippy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(
	path.join(root, "src/renderer/common/clippy.css"),
	"utf8",
);
const outIcons = path.join(root, "src/renderer/assets/icons");
const outBuild = path.join(root, "build");
fs.mkdirSync(outIcons, { recursive: true });
fs.mkdirSync(outBuild, { recursive: true });

function page(size) {
	const small = size <= 32;
	// Small sizes: just the head on a yellow tile so it stays legible in the tray.
	const art = clippyMarkup({ uid: "i" }).replace(
		/viewBox="[^"]+"/,
		small ? 'viewBox="50 30 100 100"' : 'viewBox="-18 30 236 236"',
	);
	const svg = `<div style="position:absolute;inset:${small ? "6%" : "3%"}">${art}</div>`;
	const tile = small
		? `<div style="position:absolute;inset:3%;border-radius:22%;background:radial-gradient(circle at 30% 25%,#fff7c2,#ffd84a 70%);box-shadow:inset 0 0 0 ${Math.max(1, size / 16)}px #17171c"></div>`
		: `<div style="position:absolute;left:8%;right:8%;bottom:4%;height:10%;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.35),transparent)"></div>`;
	const thick = small
		? ".c-wire-outline{stroke-width:16}.c-wire-base{stroke-width:11}.c-sclera{stroke-width:4}.c-brow{stroke-width:8}"
		: "";
	return `<!doctype html><html><head><style>${css}${thick}html,body{margin:0;background:transparent;overflow:hidden}
    #s .clippy{width:100%;height:100%}#s{position:relative;width:${size}px;height:${size}px}</style></head><body><div id="s">${tile}${svg}</div></body></html>`;
}

let win = null;
async function render(size, variantSize) {
	win ??= new BrowserWindow({
		width: 512,
		height: 512,
		show: false,
		frame: false,
		transparent: true,
		webPreferences: { offscreen: true },
	});
	const tmp = path.join(os.tmpdir(), `clippy-icon-${variantSize}-${size}.html`);
	fs.writeFileSync(
		tmp,
		page(variantSize).replaceAll(`${variantSize}px`, `${size}px`),
	);
	await win.loadFile(tmp);
	fs.rmSync(tmp, { force: true });
	await new Promise((r) => setTimeout(r, 300));
	return win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
	const sizes = [16, 24, 32, 48, 64, 128, 256];
	// Draw each variant once at high resolution, then downsample.
	const smallArt = await render(256, 16);
	const bigArt = await render(512, 512);
	const pngs = {};
	for (const s of sizes)
		pngs[s] = (s <= 32 ? smallArt : bigArt)
			.resize({ width: s, height: s, quality: "best" })
			.toPNG();
	fs.writeFileSync(path.join(outBuild, "icon.png"), bigArt.toPNG());
	const ico = await pngToIco(sizes.map((s) => pngs[s]));
	fs.writeFileSync(path.join(outBuild, "icon.ico"), ico);
	fs.writeFileSync(path.join(outIcons, "icon.ico"), ico);
	fs.writeFileSync(path.join(outIcons, "tray.png"), pngs[32]);
	fs.writeFileSync(path.join(outIcons, "icon-256.png"), pngs[256]);
	console.log("icons written");
	app.quit();
});
