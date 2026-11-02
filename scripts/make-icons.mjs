import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import icnsModule from "icon-gen/dist/lib/icns.js";
import icoModule from "icon-gen/dist/lib/ico.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appIcon = path.join(root, "assets/icons/app.svg");
const trayIcon = path.join(root, "assets/icons/tray.svg");
const output = path.join(root, "build");
const icons = path.join(output, "icons");
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function run() {
	fs.mkdirSync(icons, { recursive: true });
	const appSvg = fs.readFileSync(appIcon, "utf8");
	const traySvg = fs.readFileSync(trayIcon, "utf8");
	const pngImages = [];
	for (const size of pngSizes) {
		const filePath = path.join(icons, `${size}.png`);
		const svg = size <= 48 ? traySvg : appSvg;
		const png = new Resvg(svg, {
			fitTo: { mode: "width", value: size },
			background: "rgba(0, 0, 0, 0)",
		})
			.render()
			.asPng();
		fs.writeFileSync(filePath, png);
		pngImages.push({ filePath, size });
		console.log(`Created ${filePath}`);
	}

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
