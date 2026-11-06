import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./scripts/build.mjs";
import { startBuildWatcher } from "./scripts/watch-build.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WATCH_ROOTS = [
	path.join(ROOT, "src"),
	path.join(ROOT, "assets", "fonts"),
	path.join(ROOT, "assets", "ui-icons"),
];

let watcher;

export default {
	hooks: {
		preStart: async () => buildAll(),
		postStart: async (_forgeConfig, appProcess) => {
			watcher = startBuildWatcher({
				roots: WATCH_ROOTS,
				build: buildAll,
				onError: (error) => console.error("Development rebuild failed:", error),
			});
			appProcess.once("exit", () => {
				void watcher?.close();
			});
		},
	},
};

process.once("exit", () => {
	void watcher?.close();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		void watcher?.close();
	});
}
