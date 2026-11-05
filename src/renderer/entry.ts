const page = window.location.pathname;

if (page.endsWith("/pet/index.html")) {
	import("./pet/pet.js");
} else if (page.endsWith("/panel/index.html")) {
	import("./panel/panel.js");
} else {
	throw new Error(`Unknown renderer page: ${page}`);
}
