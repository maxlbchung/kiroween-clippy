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
]);

export function icon(name: string, size = 32) {
	if (!ICON_NAMES.has(name)) return "";
	const escapedName = encodeURIComponent(name);
	return `<img class="px-icon" src="./assets/ui-icons/${escapedName}.png" width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
