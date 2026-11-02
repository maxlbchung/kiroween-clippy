import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import icnsModule from "icon-gen/dist/lib/icns.js";
import icoModule from "icon-gen/dist/lib/ico.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSvg = fs.readFileSync(path.join(root, "assets/icons/app.svg"), "utf8");
const traySvg = fs.readFileSync(
	path.join(root, "assets/icons/tray.svg"),
	"utf8",
);
const output = path.join(root, "build");
const icons = path.join(output, "icons");
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// Sizes at or below this use the tray art, which stays legible when tiny.
const smallMax = 32;
const traySize = 32;

function renderPng(svg, size) {
	return new Resvg(svg, {
		fitTo: { mode: "width", value: size },
		background: "rgba(0, 0, 0, 0)",
	})
		.render()
		.asPng();
}

async function run() {
	fs.mkdirSync(icons, { recursive: true });
	const pngImages = [];
	for (const size of pngSizes) {
		const filePath = path.join(icons, `${size}.png`);
		const svg = size <= smallMax ? traySvg : appSvg;
		fs.writeFileSync(filePath, renderPng(svg, size));
		pngImages.push({ filePath, size });
		console.log(`Created ${filePath}`);
	}

	const trayPath = path.join(icons, "tray.png");
	fs.writeFileSync(trayPath, renderPng(traySvg, traySize));
	console.log(`Created ${trayPath}`);

	const icoGenerator = icoModule.default;
	const icnsGenerator = icnsModule.default;
	await icnsGenerator(pngImages, icons, { log() {} }, { name: "icon" });
	await icoGenerator(
		pngImages,
		icons,
		{ log() {} },
		{
			name: "icon",
			sizes: pngSizes.slice(0, -2),
		},
	);

	console.log("Renaming PNGs to Electron Format");
	for (const size of pngSizes) {
		const source = path.join(icons, `${size}.png`);
		const destination = path.join(icons, `${size}x${size}.png`);
		if (fs.existsSync(source)) fs.renameSync(source, destination);
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
