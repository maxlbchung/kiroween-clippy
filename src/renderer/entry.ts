const page = window.location.pathname;

if (page.endsWith("/pet/index.html")) {
	import("./pet/pet.js");
} else if (page.endsWith("/panel/index.html")) {
	import("./panel/panel.js");
} else if (page.endsWith("/games/dodge/index.html")) {
	import("./games/dodge/dodge.js");
} else if (page.endsWith("/games/quiz/index.html")) {
	import("./games/quiz/quiz.js");
} else if (page.endsWith("/games/seek/index.html")) {
	import("./games/seek/seek.js");
} else if (page.endsWith("/games/clicker/index.html")) {
	import("./games/clicker/clicker.js");
} else {
	throw new Error(`Unknown renderer page: ${page}`);
}
