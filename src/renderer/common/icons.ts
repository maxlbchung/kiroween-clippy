const ICON_NAMES = new Set([
	"chat",
	"direct",
	"games",
	"customize",
	"settings",
	"quit",
	"send",
	"dice",
	"reset",
	"lock",
	"key",
	"speaker",
	"monitor",
	"info",
	"check",
	"none",
	"coin",
]);

/**
 * Inline SVG markup for a 16×16 pixel icon in `assets/ui-icons/`, or an empty
 * string for unknown names. `size` is in px. Accent pixels use `currentColor`,
 * so they follow the CSS `color` of the surrounding element.
 */
export function icon(name: string, size = 32) {
	if (!ICON_NAMES.has(name)) return "";
	return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><use href="/assets/ui-icons/${name}.svg#icon"/></svg>`;
}
