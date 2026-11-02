import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

// The full output contract: one row per emitted bundle file.
export const BUNDLES = [
	{
		input: "src/main/main.ts",
		out: "main.js",
		format: "es",
		platform: "node",
		external: ["electron", /^node:/],
	},
	{
		input: "src/preload/preload.cts",
		out: "preload.js",
		format: "cjs",
		platform: "node",
		external: ["electron", /^node:/],
	},
	{
		input: "src/renderer/entry.ts",
		out: "renderer.js",
		format: "es",
		platform: "browser",
		external: [],
	},
];

const TYPESCRIPT = { target: "esnext", useDefineForClassFields: true };

/** Builds one table row into a single self-contained file under dist/. */
export async function buildBundle(row) {
	if (path.basename(row.out) !== row.out) {
		throw new Error(`Bundle output must be a plain file name: ${row.out}`);
	}
	if (row.format === "cjs" && row.platform !== "node") {
		throw new Error(
			`Bundle ${row.out} uses cjs format, which requires the node platform`,
		);
	}
	await build({
		cwd: ROOT,
		input: { entry: path.join(ROOT, row.input) },
		platform: row.platform,
		external: row.external,
		transform: { typescript: TYPESCRIPT },
		output: {
			file: path.join(DIST, row.out),
			format: row.format,
			codeSplitting: false,
		},
	});
}

/** Copies the static files the renderers load at runtime. */
async function copyAssets() {
	await cp(path.join(ROOT, "src", "renderer"), path.join(DIST, "renderer"), {
		recursive: true,
		filter: (source) => !source.endsWith(".ts") && !source.endsWith(".js"),
	});
	for (const dir of ["fonts", "ui-icons"]) {
		await cp(path.join(ROOT, "assets", dir), path.join(DIST, "assets", dir), {
			recursive: true,
		});
	}
}

/** Rebuilds dist/ from scratch: every bundle plus static assets. */
export async function buildAll() {
	await rm(DIST, { recursive: true, force: true });
	for (const row of BUNDLES) {
		await buildBundle(row);
	}
	await copyAssets();
}

// Builds only when executed directly, so importing this module has no side effects.
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	buildAll().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
