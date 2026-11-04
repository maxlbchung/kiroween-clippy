import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BUNDLE_NAMES = ["main.js", "preload.js", "renderer.js"];

const ESM_SPECIFIER =
	/(?:^|\n)\s*import\s+(?:[^"';]+?from\s+)?["']([^"']+)["']/g;
const CJS_SPECIFIER = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const RELATIVE_SPECIFIER = /(?:\bfrom\s+|\brequire\(\s*)["']\.{1,2}\//;
const PAGE_IMPORT = /import\(\s*["']\.{1,2}\/(?:pet|panel)\//;

// Loads the build module with dist/ absent, so the first test can observe
// that importing alone starts no build.
await rm(DIST, { recursive: true, force: true });
const { BUNDLES, buildBundle, buildAll } = await import("../scripts/build.mjs");

const read = (name) => readFile(path.join(DIST, name), "utf8");

async function readBundles() {
	const entries = await Promise.all(
		BUNDLE_NAMES.map(async (name) => [name, await read(name)]),
	);
	return Object.fromEntries(entries);
}

// Collects module specifiers from import statements in bundle output.
function esmSpecifiers(code) {
	return [...code.matchAll(ESM_SPECIFIER)].map((match) => match[1]);
}

// Collects require() specifiers, the form CommonJS output uses for externals.
function cjsSpecifiers(code) {
	return [...code.matchAll(CJS_SPECIFIER)].map((match) => match[1]);
}

test("importing the build module exports the API without building", () => {
	assert.equal(typeof buildAll, "function");
	assert.equal(typeof buildBundle, "function");
	assert.deepEqual(
		BUNDLES.map((row) => row.out),
		BUNDLE_NAMES,
	);
	assert.equal(existsSync(DIST), false);
});

test("buildAll emits the flat layout and a CommonJS preload", async () => {
	await buildAll();
	assert.deepEqual((await readdir(DIST)).sort(), [
		"assets",
		"main.js",
		"preload.js",
		"renderer",
		"renderer.js",
	]);
	const preload = await read("preload.js");
	assert.doesNotMatch(preload, /^\s*(import|export)\b/m);
	assert.match(preload, /require\("electron"\)/);
	for (const page of ["pet", "panel"]) {
		const html = await readFile(
			path.join(DIST, "renderer", page, "index.html"),
			"utf8",
		);
		assert.match(html, /src="\.\.\/\.\.\/renderer\.js"/);
	}
});

test("bundles stay self-contained apart from declared externals", async () => {
	const bundles = await readBundles();
	for (const [name, code] of Object.entries(bundles)) {
		assert.doesNotMatch(
			code,
			RELATIVE_SPECIFIER,
			`${name} keeps a relative specifier`,
		);
	}
	const isExternal = (specifier) =>
		specifier === "electron" || specifier.startsWith("node:");
	for (const specifier of esmSpecifiers(bundles["main.js"])) {
		assert.ok(isExternal(specifier), `main.js imports "${specifier}"`);
	}
	for (const specifier of cjsSpecifiers(bundles["preload.js"])) {
		assert.ok(isExternal(specifier), `preload.js requires "${specifier}"`);
	}
	assert.deepEqual(esmSpecifiers(bundles["renderer.js"]), []);
	assert.deepEqual(cjsSpecifiers(bundles["renderer.js"]), []);
});

test("renderer bundle inlines both pages", async () => {
	const code = await read("renderer.js");
	assert.match(code, /clippy-hit/, "pet page code missing");
	assert.match(code, /arcade/, "panel page code missing");
	assert.doesNotMatch(code, PAGE_IMPORT);
});

test("runtime paths the main process computes exist in dist", async () => {
	assert.ok(existsSync(path.join(DIST, "preload.js")));
	for (const page of ["pet", "panel"]) {
		assert.ok(
			existsSync(path.join(DIST, "renderer", page, "index.html")),
			`renderer/${page}/index.html missing`,
		);
	}
	for (const dir of ["fonts", "ui-icons"]) {
		const files = await readdir(path.join(DIST, "assets", dir));
		assert.ok(files.length > 0, `dist/assets/${dir} is empty`);
	}
});

test("rebuilding an unchanged tree reproduces identical bytes", async () => {
	const before = await readBundles();
	await buildAll();
	assert.deepEqual(await readBundles(), before);
});

test("buildBundle reports unresolvable inputs without writing output", async () => {
	await assert.rejects(
		buildBundle({
			input: "src/main/does-not-exist.ts",
			out: "x.js",
			format: "es",
			platform: "node",
			external: [],
		}),
		/does-not-exist\.ts/,
	);
	assert.equal(existsSync(path.join(DIST, "x.js")), false);
});

test("CLI guard runs only for the build script entry", () => {
	const buildScript = path.join(ROOT, "scripts", "build.mjs");
	const renderer = path.join(DIST, "renderer.js");
	const before = readFileSync(renderer, "utf8");
	const result = spawnSync(process.execPath, [
		"--input-type=module",
		"-e",
		`await import(${JSON.stringify(buildScript)});`,
	]);
	assert.equal(result.status, 0, String(result.stderr));
	assert.equal(readFileSync(renderer, "utf8"), before);
});
