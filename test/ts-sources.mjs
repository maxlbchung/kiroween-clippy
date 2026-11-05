import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../src",
);

// Remaps relative ".js" specifiers imported by TypeScript sources under src/ to
// the sibling ".ts" file, so Node's native type stripping runs the source graph.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			specifier.endsWith(".js") &&
			(specifier.startsWith("./") || specifier.startsWith("../")) &&
			context.parentURL &&
			fileURLToPath(context.parentURL).startsWith(SRC + path.sep)
		) {
			const tsUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
				.href;
			if (existsSync(fileURLToPath(tsUrl))) {
				return { url: tsUrl, shortCircuit: true };
			}
		}
		return nextResolve(specifier, context);
	},
});
