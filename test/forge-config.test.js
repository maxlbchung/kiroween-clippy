import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import config from "../forge.config.js";
import { configureWindowPlatform } from "../src/main/platform.ts";

test("preStart builds output before Forge launches the app", async () => {
	await config.hooks.preStart({});
	assert.equal(existsSync(new URL("../dist/main.js", import.meta.url)), true);
	assert.equal(
		existsSync(new URL("../dist/preload.js", import.meta.url)),
		true,
	);
	assert.equal(
		existsSync(new URL("../dist/renderer.js", import.meta.url)),
		true,
	);
});

test("postStart starts the watcher without changing the child process", async () => {
	const listeners = new Map();
	const appProcess = {
		pid: 123,
		kill: () => assert.fail("process restarted"),
		once: (event, callback) => listeners.set(event, callback),
	};
	await config.hooks.postStart({}, appProcess);
	assert.equal(appProcess.pid, 123);
	assert.equal(listeners.has("exit"), true);
	listeners.get("exit")();
});

test("Linux uses X11 and an in-process GPU", () => {
	const switches = [];
	configureWindowPlatform({
		platform: "linux",
		appendSwitch: (...value) => switches.push(value),
	});
	assert.deepEqual(switches, [["ozone-platform", "x11"], ["in-process-gpu"]]);
});

test("other platforms keep their default window backend", () => {
	const switches = [];
	for (const platform of ["win32", "darwin"]) {
		configureWindowPlatform({
			platform,
			appendSwitch: (...value) => switches.push(value),
		});
	}
	assert.deepEqual(switches, []);
});
