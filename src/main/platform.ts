export function configureWindowPlatform({
	platform,
	appendSwitch,
}: {
	platform: NodeJS.Platform;
	appendSwitch: (name: string, value: string) => void;
}) {
	if (platform === "linux") appendSwitch("ozone-platform", "x11");
}
