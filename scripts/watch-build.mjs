import path from "node:path";
import chokidar from "chokidar";

const DEFAULT_DEBOUNCE_MS = 100;

export function startBuildWatcher({
	roots,
	ignored = [],
	debounceMs = DEFAULT_DEBOUNCE_MS,
	build,
	onError = console.error,
}) {
	let timer;
	let building = false;
	let changedDuringBuild = false;
	let closed = false;

	const ignoredPaths = [...ignored, "dist", "node_modules", ".git", "out"].map(
		(ignoredPath) => path.resolve(ignoredPath),
	);
	const watcher = chokidar.watch(roots, {
		ignored: (filePath) =>
			ignoredPaths.some((ignoredPath) =>
				isWithin(path.resolve(filePath), ignoredPath),
			),
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
	});
	let resolveReady;
	const ready = new Promise((resolve) => {
		resolveReady = resolve;
	});
	watcher.once("ready", resolveReady);

	const runBuild = async () => {
		if (closed) return;
		if (building) {
			changedDuringBuild = true;
			return;
		}

		building = true;
		try {
			await build();
		} catch (error) {
			try {
				onError(error);
			} catch (reportError) {
				console.error("Build error reporter failed:", reportError);
			}
		} finally {
			building = false;
			if (changedDuringBuild && !closed) {
				changedDuringBuild = false;
				scheduleBuild();
			}
		}
	};

	function scheduleBuild() {
		if (closed) return;
		clearTimeout(timer);
		timer = setTimeout(runBuild, debounceMs);
	}

	watcher.on("all", (_event, filePath) => {
		if (isBuildInput(filePath)) scheduleBuild();
	});
	watcher.on("error", onError);

	return {
		ready,
		async close() {
			closed = true;
			clearTimeout(timer);
			await watcher.close();
		},
	};
}

function isWithin(candidate, parent) {
	const relative = path.relative(parent, candidate);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) && relative !== "..")
	);
}

function isBuildInput(filePath) {
	return /\.(?:[cm]?[jt]sx?|html|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(
		filePath,
	);
}
