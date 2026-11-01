import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
const result = spawnSync(
	process.execPath,
	[
		path.join(root, "node_modules", "typescript", "bin", "tsc"),
		"-p",
		path.join(root, "tsconfig.json"),
	],
	{
		cwd: root,
		stdio: "inherit",
	},
);
if (result.status !== 0) process.exit(result.status ?? 1);

for (const dir of ["renderer"]) {
	await cp(path.join(root, "src", dir), path.join(dist, dir), {
		recursive: true,
		filter: (source) => !source.endsWith(".ts") && !source.endsWith(".js"),
	});
}
