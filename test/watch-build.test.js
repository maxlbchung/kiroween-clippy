import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startBuildWatcher } from "../scripts/watch-build.mjs";

async function setup(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), "clippy-watch-"));
	const source = path.join(root, "src");
	const ignored = path.join(root, "dist");
	await mkdir(source);
	await mkdir(ignored);
	t.after(async () => rm(root, { recursive: true, force: true }));
	return { root, source, ignored };
}

test("watcher coalesces rapid edits and ignores generated output", async (t) => {
	const { source, ignored } = await setup(t);
	let builds = 0;
	const watcher = startBuildWatcher({
		roots: [source],
		ignored: [ignored],
		debounceMs: 50,
		build: async () => builds++,
	});
	t.after(() => watcher.close());
	await watcher.ready;
	await writeFile(path.join(source, "one.ts"), "export const one = 1;");
	await writeFile(path.join(source, "two.ts"), "export const two = 2;");
	await writeFile(path.join(source, "notes.md"), "ignored");
	await writeFile(path.join(ignored, "generated.js"), "ignored");
	await delay(250);
	assert.equal(builds, 1);
});

test("watcher serializes active builds and retries after failure", async (t) => {
	const { source } = await setup(t);
	let builds = 0;
	let active = 0;
	let maxActive = 0;
	const errors = [];
	let release;
	const firstBuild = new Promise((resolve) => {
		release = resolve;
	});
	const watcher = startBuildWatcher({
		roots: [source],
		debounceMs: 30,
		build: async () => {
			builds++;
			active++;
			maxActive = Math.max(maxActive, active);
			try {
				if (builds === 1) {
					await firstBuild;
					throw new Error("first build failed");
				}
			} finally {
				active--;
			}
		},
		onError: (error) => errors.push(error),
	});
	t.after(() => watcher.close());
	await watcher.ready;
	await writeFile(path.join(source, "first.ts"), "export const first = 1;");
	await delay(100);
	await writeFile(path.join(source, "second.ts"), "export const second = 2;");
	release();
	await delay(250);
	assert.equal(builds, 2);
	assert.equal(maxActive, 1);
	assert.equal(errors.length, 1);
	assert.match(errors[0].message, /first build failed/);
});

test("closing the watcher prevents subsequent builds", async (t) => {
	const { source } = await setup(t);
	let builds = 0;
	const watcher = startBuildWatcher({
		roots: [source],
		debounceMs: 30,
		build: async () => builds++,
	});
	await watcher.ready;
	await watcher.close();
	await writeFile(
		path.join(source, "closed.ts"),
		"export const closed = true;",
	);
	await delay(100);
	assert.equal(builds, 0);
});
