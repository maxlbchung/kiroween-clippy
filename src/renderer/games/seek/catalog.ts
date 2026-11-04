// Hide & Seek window catalogue: the fake apps, web pages and dialogs that make
// up the pile. Each kind builds a window's title and body HTML with some
// randomness. Hiding boxes are empty `<i class="slot">` elements placed in the
// content; the game measures them once the window is laid out and fills a few
// with Clippies or decoys. Content marked `data-decoy` is a decoy as it is.

import { esc } from "../../common/ui.js";
import {
	between,
	type Pose,
	pickOne,
	type Rng,
	type Size,
	shuffle,
} from "./layout.js";

export type Draft = {
	kind: string;
	title: string;
	/** Title-bar icon, a `ti-*` class. */
	icon: string;
	w: number;
	h: number;
	/** Extra classes for the window element. */
	cls: string;
	body: string;
	/** Message boxes have only a close button. */
	dialog?: boolean;
};

type Kind = {
	id: string;
	/** Relative chance of being picked for the pile. */
	weight: number;
	/** Most windows of this kind in one pile. */
	max: number;
	make(rng: Rng): Draft;
};

export type DecoyKind = "paperclip" | "binder" | "stapler" | "pushpin";

/** Decoy art, its desk size, and what the game says when one is clicked. */
export const DECOYS: Record<DecoyKind, { size: Size; line: string }> = {
	paperclip: { size: { w: 26, h: 66 }, line: "Just a paper clip!" },
	binder: { size: { w: 40, h: 45 }, line: "That's a binder clip." },
	stapler: { size: { w: 72, h: 36 }, line: "That's a stapler." },
	pushpin: { size: { w: 28, h: 40 }, line: "Ouch! A pushpin." },
};

const art = (name: string, cls = "", decoy?: DecoyKind) =>
	`<img class="${cls}" src="art/${name}.svg" alt="" draggable="false"${decoy ? ` data-decoy="${decoy}"` : ""}>`;

/** An empty hiding box; `css` positions it inside its containing block. */
const slot = (pose: Pose, css: string) =>
	`<i class="slot" data-pose="${pose}" style="${css}"></i>`;

const menu = (...items: string[]) =>
	`<div class="menu">${items.map((i) => `<span><u>${esc(i[0])}</u>${esc(i.slice(1))}</span>`).join("")}</div>`;

const status = (...cells: string[]) =>
	`<div class="status">${cells.map((c) => `<span>${esc(c)}</span>`).join("")}</div>`;

const pickN = <T>(rng: Rng, xs: readonly T[], n: number) =>
	shuffle(rng, xs).slice(0, n);

const int = (rng: Rng, a: number, b: number) =>
	Math.floor(between(rng, a, b + 1));

const HEADLINES = [
	"Local paper clip refuses to retire, demands corner office",
	"Man closes 47 pop-ups; the 48th asks if he needs help",
	"Haunted printer only jams on Fridays",
	"Office assistant spotted hiding in plain sight",
	"Study: nine out of ten letters look like a letter",
	"Pumpkin spice found inside floppy drive",
	"Scientists confirm the screensaver is, in fact, saving the screen",
	"Desktop declared a disaster area after window pile-up",
];
const TICKER = [
	"Y2K only 427 days away",
	"Stapler stocks soar",
	"Paper clip sightings up 300%",
	"Recycle Bin full again",
	"Dial-up speeds hit 56k",
];
const LOREM = [
	"Witnesses describe a shiny, bendy figure with enormous eyebrows ducking behind a spreadsheet.",
	"Officials urge residents to check behind every window, especially the ones they meant to close.",
	"The suspect was last seen asking whether anyone needed help writing a letter.",
	"Experts recommend dragging title bars slowly and keeping one eye on the sidebar ads.",
	"Local cats remain unimpressed and continue to sit on keyboards.",
	"Sources close to the Recycle Bin declined to comment.",
	"Readers are reminded that clicking wildly has never once found anything.",
];

type Site = { title: string; url: string; cls: string; html: string };

function newsSite(rng: Rng): Site {
	const [lead, ...more] = pickN(rng, HEADLINES, 5);
	const photo = pickOne(rng, ["haunted", "pumpkins", "cat", "beach"]);
	return {
		title: "The Daily Byte",
		url: "http://www.dailybyte.com/news/today.html",
		cls: "site-news",
		html: `
      <div class="mast"><b>The Daily Byte</b><span>Saturday, Oct 31, 1998 &middot; Late Edition</span></div>
      <div class="ticker"><span>BREAKING: ${esc(pickOne(rng, TICKER))} &bull; ${esc(pickOne(rng, TICKER))} &bull; Weather: partly clippy</span></div>
      <div class="cols">
        <div class="main">
          <h1>${esc(lead)}</h1>
          <div class="photo">${art(photo)}</div>
          <p class="cap">Our photographer, moments before the pop-up.</p>
          <p>${esc(pickOne(rng, LOREM))} ${esc(pickOne(rng, LOREM))}</p>
        </div>
        <div class="side">
          <div class="adlabel">ADVERTISEMENT</div>
          <div class="ad">${slot("up", `left:${int(rng, 4, 40)}px;top:-31px;width:30px;height:30px`)}<b>YOU ARE THE 1,000,000th VISITOR!</b><u>CLICK HERE</u></div>
          <div class="wx"><b>72&deg;</b> Partly clippy</div>
        </div>
      </div>
      <h2>More stories</h2>
      <ul class="more">${more.map((h) => `<li><u>${esc(h)}</u></li>`).join("")}</ul>
      <div class="promo"><span>Get The Daily Byte on your pager!</span>${slot("up", `right:${int(rng, 12, 120)}px;top:-29px;width:28px;height:28px`)}</div>
      <p>${esc(pickOne(rng, LOREM))}</p>
      <div class="foot">&copy; 1998 The Daily Byte. Best viewed in 800&times;600.</div>`,
	};
}

const QUERIES = [
	"where is clippy hiding",
	"how to find a paper clip",
	"is my paper clip watching me",
	"free screensavers no virus",
	"how to close all windows at once",
];
const RESULTS = [
	[
		"Paper Clip Fan Club - Official Homepage",
		"www.clipfans.org/",
		"Join thousands of fans. Updated weekly. Now with a guestbook!",
	],
	[
		"10 Places a Paper Clip Could Be Hiding",
		"www.top10.com/clips",
		"Number 7 will surprise you. Hint: look behind the windows.",
	],
	[
		"How to Close Pop-Ups (Part 1 of 47)",
		"www.helpdesk.net/popups",
		"Step one: click the X. Step two: see step one.",
	],
	[
		"Hide and Seek - Rules and Strategy",
		"www.playground.edu/seek",
		"Count to three. No peeking. Check under the sidebar ads.",
	],
	[
		"Free Screensavers! Flying Toasters!",
		"www.saverz.com/",
		"Download 200 screensavers in only 9 hours on a 28.8k modem.",
	],
	[
		"Staplers, Binder Clips and Other Lookalikes",
		"www.officemart.com/clips",
		"Not everything shiny and bendy is who you are looking for.",
	],
];

const LOGO = ["#2f7cf6", "#e5484d", "#ffb224", "#2f7cf6", "#30a46c", "#e5484d"];

function searchSite(rng: Rng): Site {
	const q = pickOne(rng, QUERIES);
	const results = pickN(rng, RESULTS, 5);
	return {
		title: `Fetch! Search: ${q}`,
		url: `http://www.fetch.com/search?q=${q.replaceAll(" ", "+")}`,
		cls: "site-search",
		html: `
      <div class="logo">${[..."Fetch!"].map((ch, i) => `<b style="color:${LOGO[i % LOGO.length]}">${ch}</b>`).join("")}</div>
      <div class="qrow"><span class="q">${esc(q)}</span><span class="btn btn-sm">Fetch!</span>${slot("left", "left:100%;top:-6px;width:36px;height:32px;margin-left:2px")}</div>
      <p class="found">Results 1-5 of about 1,024 for <b>${esc(q)}</b></p>
      <div class="sres">
        <div class="list">${results
					.map(
						([t, u, d]) =>
							`<div class="r"><u>${esc(t)}</u><span class="u">${esc(u)}</span><span>${esc(d)}</span></div>`,
					)
					.join("")}</div>
        <div class="spons"><b>Sponsored</b>${slot("up", `left:${int(rng, 6, 50)}px;top:-31px;width:30px;height:30px`)}<u>Win a free mousepad</u><u>Hot screensavers</u><u>Learn HTML in 21 days</u></div>
      </div>
      <div class="pages">Result page: <u>1</u> <u>2</u> <u>3</u> <u>4</u> <u>Next &gt;</u>${slot("down", `left:${int(rng, 40, 180)}px;top:100%;width:30px;height:30px`)}</div>
      <div class="foot">&copy; 1998 Fetch! Inc. Good boy.</div>`,
	};
}

const SUBJECTS = [
	["Mom", "FW: FW: FW: dancing baby"],
	["Prize Dept", "You have WON a free mousepad!!!"],
	["Kiro", "Re: who keeps moving my windows"],
	["Boss", "Meeting moved to 3pm (again)"],
	["IT Desk", "Please stop installing screensavers"],
	["Clippy", "Hide & seek tournament - sign up!"],
	["Grandpa", "Chain letter: send to 10 friends"],
	["Newsletter", "Staplers 50% off this weekend"],
];

function mailSite(rng: Rng): Site {
	const rows = pickN(rng, SUBJECTS, 6);
	const open = rows[int(rng, 0, rows.length - 1)];
	return {
		title: "HotPost Mail - Inbox",
		url: "http://www.hotpost.com/cgi-bin/inbox",
		cls: "site-mail",
		html: `
      <div class="mtop"><b>HotPost</b><span>Inbox (${int(rng, 3, 99)} new)</span></div>
      <div class="mgrid">
        <div class="folders">
          <span class="on">Inbox</span><span>Sent</span><span>Drafts</span><span>Junk (999)</span><span>Trash</span>
          <div class="quota">${slot("up", "left:8px;top:-29px;width:28px;height:28px")}<small>Storage</small><i><b class="fill" style="width:${int(rng, 85, 99)}%"></b></i></div>
        </div>
        <div class="msgs">
          <table>${rows
						.map(
							([from, subject], i) =>
								`<tr class="${i < 3 ? "new" : ""}${subject === open[1] ? " sel" : ""}"><td>${esc(from)}</td><td>${esc(subject)}</td></tr>`,
						)
						.join("")}</table>
          <div class="preview">
            <p><b>From:</b> ${esc(open[0])}<br><b>Subject:</b> ${esc(open[1])}</p>
            <p>Hi!! Did you see where the paper clip went? He was right here a second ago. Write back soon!!</p>
            <div class="attach">${art("paperclip", "clipicon", "paperclip")}<span>photo.bmp (48 KB)</span></div>
          </div>
        </div>
      </div>
      <div class="sig">${slot("up", `left:${int(rng, 30, 200)}px;top:-29px;width:28px;height:28px`)}Sent with HotPost. Get your free e-mail at www.hotpost.com</div>`,
	};
}

const PRODUCTS: [string, string, string, DecoyKind?][] = [
	["stapler", "Deluxe Stapler", "$12.99", "stapler"],
	["paperclip", "Paper Clips (100)", "$1.49", "paperclip"],
	["binder", "Binder Clips", "$3.99", "binder"],
	["pushpin", "Pushpins (50)", "$2.49", "pushpin"],
	["mug", "World's Best Mug", "$7.99"],
	["tape", "Tape Dispenser", "$5.49"],
];

function shopSite(rng: Rng): Site {
	const items = [...shuffle(rng, PRODUCTS), ...shuffle(rng, PRODUCTS)].slice(
		0,
		9,
	);
	const peek = int(rng, 0, items.length - 1);
	return {
		title: "OfficeMart - Office Supplies",
		url: "http://www.officemart.com/supplies/clips.html",
		cls: "site-shop",
		html: `
      <div class="stop"><b>OfficeMart</b><span>Cart (0) &middot; Sign in</span></div>
      <div class="banner">FALL SALE! Everything must go, except the paper clips.</div>
      <div class="grid">${items
				.map(
					([name, label, price, decoy], i) =>
						`<div class="card"><div class="pic"><span class="prod">${i === peek ? slot("up", `left:${int(rng, -6, 14)}px;bottom:100%;width:26px;height:26px`) : ""}${art(name, "", decoy)}</span></div><b>${esc(label)}</b><span>${price}</span><span class="btn btn-sm">Add to cart</span></div>`,
				)
				.join("")}</div>
      <div class="foot">Free shipping on orders over $5,000.${slot("up", `left:${int(rng, 10, 220)}px;top:-29px;width:28px;height:28px`)}</div>`,
	};
}

function wikiSite(rng: Rng): Site {
	return {
		title: "Paper clip - Wikipaedia, the free encyclopaedia",
		url: "http://www.wikipaedia.org/wiki/Paper_clip",
		cls: "site-wiki",
		html: `
      <h1>Paper clip</h1>
      <p class="from">From Wikipaedia, the free encyclopaedia</p>
      <div class="infobox">${slot("up", `left:${int(rng, 6, 60)}px;top:-31px;width:30px;height:30px`)}<b>Paper clip</b>${art("paperclip", "", "paperclip")}<dl><dt>Type</dt><dd>Fastener</dd><dt>Material</dt><dd>Steel wire</dd><dt>Eyebrows</dt><dd>Sometimes</dd></dl></div>
      <p>A <b>paper clip</b> is a device used to hold sheets of paper together, usually made of steel wire bent into a looped shape. Some paper clips have been reported to blink.</p>
      <div class="toc"><b>Contents</b><span>1 History</span><span>2 Design</span><span>3 Hiding</span><span>4 See also</span></div>
      <h2>History</h2>
      <p>${esc(pickOne(rng, LOREM))} ${esc(pickOne(rng, LOREM))}</p>
      <h2>Hiding</h2>
      <p>Paper clips are excellent at hide and seek. They are thin, shiny and very patient.</p>
      <h2>See also</h2>
      <div class="gallery">${shuffle(rng, ["binder", "stapler", "pushpin", ""])
				.map((name) =>
					name
						? `<span>${art(name, "", name as DecoyKind)}</span>`
						: `<span>${slot("whole", "left:22px;top:6px;width:22px;height:52px")}</span>`,
				)
				.join("")}</div>`,
	};
}

const FRIENDS = [
	"#e5484d",
	"#2f7cf6",
	"#30a46c",
	"#ffb224",
	"#8e4ec6",
	"#ff7a1a",
	"#12a594",
	"#d6409f",
];
const FRIEND_NAMES = [
	"Tom",
	"Kiro",
	"Dot",
	"Floppy",
	"Mo",
	"Pixel",
	"Bit",
	"Zip",
];

function socialSite(rng: Rng): Site {
	const peek = int(rng, 0, 7);
	const names = shuffle(rng, FRIEND_NAMES);
	return {
		title: "MySpot - xX_Kiro_Xx's profile",
		url: "http://www.myspot.com/xX_Kiro_Xx",
		cls: "site-social",
		html: `
      <div class="ptop"><b>MySpot</b><span>a place for friends</span></div>
      <div class="prow">
        <div class="pic">${art(pickOne(rng, ["cat", "beach", "pumpkins"]))}</div>
        <div class="who"><b>xX_Kiro_Xx</b><span>"hiding is my cardio"</span><span>Mood: sneaky</span><span class="online">ONLINE NOW!</span></div>
      </div>
      <h2>xX_Kiro_Xx's Top 8</h2>
      <div class="top8">${shuffle(rng, FRIENDS)
				.map(
					(c, i) =>
						`<span>${i === peek ? `<i class="face nophoto"></i>${slot("up", "left:9px;top:8px;width:30px;height:30px")}` : `<i class="face" style="background:${c}"></i>`}<b>${esc(names[i])}</b></span>`,
				)
				.join("")}</div>
      <h2>Comments</h2>
      <div class="cmt"><b>Floppy:</b> thx 4 the add!!! :)</div>
      <div class="cmt"><b>Tom:</b> ur page loads so slow lol</div>
      <div class="cmt">${slot("up", `right:${int(rng, 8, 140)}px;top:-29px;width:28px;height:28px`)}<b>Dot:</b> did u ever find that paper clip</div>`,
	};
}

const POSTS = [
	[
		"MouseMaster98",
		"Has anyone seen Clippy today? He said 'count to three' and then all my windows exploded.",
	],
	["FloppyFan", "Check behind the video player. Trust me."],
	[
		"admin",
		"Please keep the paper clip discussion in the paper clip subforum.",
	],
	["n00b_42", "i closed all my windows and now there are MORE windows??"],
	["KiroWeen", "Pro tip: drag the title bars. Do not click like a maniac."],
];

function forumSite(rng: Rng): Site {
	const posts = pickN(rng, POSTS, 4);
	const peek = int(rng, 0, posts.length - 1);
	return {
		title: "ClipTalk Forums - Has anyone seen Clippy?",
		url: "http://www.cliptalk.net/forum/viewtopic.php?t=1998",
		cls: "site-forum",
		html: `
      <div class="ftop"><b>ClipTalk Forums</b><span>Board index &raquo; Off-topic</span></div>
      <h1>Has anyone seen Clippy?</h1>
      ${posts
				.map(
					([user, text], i) =>
						`<div class="post"><div class="poster"><b>${esc(user)}</b><span class="av" style="background:${pickOne(rng, FRIENDS)}">${i === peek ? slot("up", "left:7px;top:4px;width:30px;height:30px") : ""}<i></i></span><small>Posts: ${int(rng, 3, 9999)}</small></div><div class="text">${esc(text)}<hr><small>~*~ Sent from my 486 ~*~</small></div></div>`,
				)
				.join("")}
      <div class="foot">Powered by phpBBQ &copy; 1998</div>`,
	};
}

function homeSite(rng: Rng): Site {
	return {
		title: "~*~ Kiro's Homepage ~*~",
		url: "http://www.geocabins.com/Area51/Spooky/1998/",
		cls: "site-home",
		html: `
      <h1>~*~ Welcome 2 my Homepage!!! ~*~</h1>
      <div class="marq"><span>Thanx 4 visiting!!! Sign my guestbook!!! Happy Halloween!!!</span></div>
      <div class="uc">${slot("up", `left:${int(rng, 10, 80)}px;top:-31px;width:30px;height:30px`)}<b>UNDER CONSTRUCTION</b></div>
      <p>This page is about my 3 favorite things: pumpkins, paper clips, and hide and seek.</p>
      <div class="ghosts">${art("ghost")}${art("ghost")}${art("ghost")}</div>
      <p class="count">You are visitor #<b>${String(int(rng, 100, 9999)).padStart(6, "0")}</b></p>
      <div class="gb">${slot("down", `left:${int(rng, 20, 180)}px;top:100%;width:30px;height:30px`)}<u>Sign my Guestbook</u> &middot; <u>View my Guestbook</u></div>
      <p class="webring">&laquo; Prev &middot; <b>Spooky Webring</b> &middot; Next &raquo;</p>
      <p class="best">Best viewed with Internet Exploder 4.0 at 800&times;600</p>`,
	};
}

const SITES = [
	newsSite,
	searchSite,
	mailSite,
	shopSite,
	wikiSite,
	socialSite,
	forumSite,
	homeSite,
];
let siteDeck: typeof SITES = [];

function browser(rng: Rng): Draft {
	if (!siteDeck.length) siteDeck = shuffle(rng, SITES);
	const site = siteDeck.pop()(rng);
	const w = pickOne(rng, [440, 460, 480]);
	const h = pickOne(rng, [340, 360, 380]);
	return {
		kind: "browser",
		title: `${site.title} - Internet Exploder`,
		icon: "ti-web",
		w,
		h,
		cls: "k-browser",
		body: `
      ${menu("File", "Edit", "View", "Go", "Favorites", "Help")}
      <div class="addr"><span class="nav back"></span><span class="nav fwd"></span><span class="lbl">Address</span><span class="url">${esc(site.url)}</span></div>
      <div class="page scroll ${site.cls}">${site.html}</div>
      ${status("Done", "Internet zone")}`,
	};
}

const PICTURES = ["cat", "hills", "beach", "pumpkins", "haunted"];

function viewer(rng: Rng): Draft {
	const pic = pickOne(rng, PICTURES);
	const ext = pickOne(rng, ["bmp", "jpg", "gif"]);
	const slots = [
		slot("up", `left:${int(rng, 10, 250)}px;top:-31px;width:30px;height:30px`),
		slot(
			"left",
			`left:100%;top:${int(rng, 20, 140)}px;width:34px;height:30px;margin-left:1px`,
		),
		slot(
			"right",
			`right:100%;top:${int(rng, 20, 140)}px;width:34px;height:30px;margin-right:1px`,
		),
	];
	return {
		kind: "viewer",
		title: `${pic}.${ext} - Imaging`,
		icon: "ti-img",
		w: 380,
		h: 330,
		cls: "k-viewer",
		body: `
      ${menu("File", "Edit", "View", "Zoom", "Help")}
      <div class="tools"><span class="tb">+</span><span class="tb">&minus;</span><span class="tb">&#8635;</span><span class="sep"></span><span class="zoom">100%</span></div>
      <div class="canvas"><div class="frame">${art(pic)}${slots.join("")}</div></div>
      ${status(`${pic}.${ext}`, "320 x 200 x 256 colors")}`,
	};
}

function video(rng: Rng): Draft {
	const tank = rng() < 0.6;
	const total = int(rng, 90, 400);
	const fmt = (s: number) =>
		`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	return {
		kind: "video",
		title: `${tank ? "fishtank.avi" : "ghost_cam.mpg"} - Media Player`,
		icon: "ti-video",
		w: 380,
		h: 300,
		cls: "k-video",
		body: `
      ${menu("File", "View", "Play", "Favorites", "Help")}
      <div class="screen ${tank ? "tank" : "spooky"}">
        ${art(tank ? "aquarium" : "haunted", "bg")}
        ${tank ? `${art("fish", "fish f1")}${art("fish", "fish f2")}` : `${art("ghost", "ghost g1")}${art("ghost", "ghost g2")}`}
        ${slot("up", `left:${int(rng, 30, 300)}px;bottom:0;width:30px;height:30px`)}
        ${
					tank
						? `${slot("right", "right:53.2%;top:60%;width:34px;height:30px")}${slot("up", "left:calc(56.3% - 15px);top:calc(65.6% - 30px);width:30px;height:30px")}`
						: slot("right", "right:52.6%;top:52%;width:34px;height:30px")
				}
      </div>
      <div class="ctrl"><span class="play"></span><span class="stop"></span><div class="seek"><i style="--len:${total}s"></i></div><span class="time px">${fmt(int(rng, 5, total - 5))} / ${fmt(total)}</span></div>`,
	};
}

const NOTES = [
	[
		"todo.txt",
		"TODO\n- buy floppy disks\n- find Clippy\n- close ALL the windows\n- do not let Clippy see this list\n- water the cactus",
	],
	[
		"poem.txt",
		"Roses are red,\nwindows are blue,\na paper clip's hiding\nand watching you.",
	],
	[
		"groceries.txt",
		"milk\neggs\npumpkin (big)\nstaples\nmore staples\nfun-size candy x 40",
	],
	[
		"readme.txt",
		"HIDE & SEEK v1.0\n\nRules:\n1. Count to three.\n2. No peeking.\n3. Look behind EVERYTHING.",
	],
	[
		"diary.txt",
		"Dear diary,\ntoday the paper clip asked if\nI was writing a letter.\nI was not.\nHe asked again.",
	],
];

function notepad(rng: Rng): Draft {
	const [name, text] = pickOne(rng, NOTES);
	return {
		kind: "notepad",
		title: `${name} - Notepad`,
		icon: "ti-note",
		w: pickOne(rng, [280, 300, 320]),
		h: pickOne(rng, [200, 230]),
		cls: "k-notepad",
		body: `${menu("File", "Edit", "Search", "Help")}<div class="paper">${esc(text)}<span class="caret"></span></div>`,
	};
}

const PALETTE = [
	"#000",
	"#808080",
	"#800000",
	"#808000",
	"#008000",
	"#008080",
	"#000080",
	"#800080",
	"#fff",
	"#c0c0c0",
	"#f00",
	"#ff0",
	"#0f0",
	"#0ff",
	"#00f",
	"#f0f",
];

function paint(rng: Rng): Draft {
	const tools = 16;
	return {
		kind: "paint",
		title: "untitled - Paint",
		icon: "ti-paint",
		w: 420,
		h: 320,
		cls: "k-paint",
		body: `
      ${menu("File", "Edit", "View", "Image", "Colors", "Help")}
      <div class="studio">
        <div class="toolbox">${Array.from({ length: tools }, (_, i) => `<span class="tool t${i}"></span>`).join("")}</div>
        <div class="easel"><div class="sheet">${art("doodle")}${slot("whole", `left:${int(rng, 230, 290)}px;top:${int(rng, 70, 110)}px;width:24px;height:56px`)}${slot("lie", `left:${int(rng, 10, 150)}px;top:${int(rng, 148, 154)}px;width:60px;height:26px`)}</div></div>
      </div>
      <div class="colors"><span class="cur"><i></i><b></b></span>${PALETTE.map((c) => `<span style="background:${c}"></span>`).join("")}</div>`,
	};
}

const FILES = [
	["folder", "My Pictures"],
	["folder", "Homework"],
	["folder", "Taxes 1998"],
	["folder", "New Folder (3)"],
	["folder", "secret"],
	["txt", "readme.txt"],
	["txt", "todo.txt"],
	["exe", "setup.exe"],
	["exe", "solitaire.exe"],
	["bmp", "clips.bmp"],
	["bmp", "cat.bmp"],
	["zip", "stuff.zip"],
];

function explorer(rng: Rng): Draft {
	const files = pickN(rng, FILES, 10);
	const peek = int(rng, 0, files.length - 1);
	const tiny = (peek + int(rng, 2, 6)) % files.length;
	return {
		kind: "explorer",
		title: "C:\\My Documents",
		icon: "ti-folder",
		w: 400,
		h: 300,
		cls: "k-explorer",
		body: `
      ${menu("File", "Edit", "View", "Go", "Favorites", "Help")}
      <div class="addr"><span class="lbl">Address</span><span class="url">C:\\My Documents</span></div>
      <div class="icons">${files
				.map(
					([type, name], i) =>
						`<span class="file"><i class="fi ${type}">${type === "bmp" && name === "clips.bmp" ? art("paperclip", "", "paperclip") : ""}</i>${i === peek ? slot("up", "left:calc(50% - 12px);top:-24px;width:24px;height:24px") : ""}${i === tiny ? slot("whole", "left:calc(50% + 18px);top:0;width:14px;height:34px") : ""}<b>${esc(name)}</b></span>`,
				)
				.join("")}</div>
      ${status(`${files.length} object(s)`, `${int(rng, 1, 9)}.${int(rng, 0, 9)} MB`)}`,
	};
}

function calculator(rng: Rng): Draft {
	const keys = [
		"MC",
		"7",
		"8",
		"9",
		"/",
		"sqrt",
		"MR",
		"4",
		"5",
		"6",
		"*",
		"%",
		"MS",
		"1",
		"2",
		"3",
		"-",
		"1/x",
		"M+",
		"0",
		"+/-",
		".",
		"+",
		"=",
	];
	return {
		kind: "calc",
		title: "Calculator",
		icon: "ti-calc",
		w: 240,
		h: 250,
		cls: "k-calc",
		body: `
      ${menu("Edit", "View", "Help")}
      <div class="lcd">${pickOne(rng, ["3.1415926535", "0.", "1998.", "42.", "404.", "31.10"])}</div>
      <div class="keys">${keys.map((k) => `<span class="btn btn-sm key${/[0-9.]/.test(k) && k.length === 1 ? " num" : ""}${/^M/.test(k) ? " mem" : ""}">${esc(k)}</span>`).join("")}</div>`,
	};
}

const SONGS = [
	"Clippy - Hide and Seek (Remix)",
	"DJ Stapler - Binder Beats",
	"The Pop-Ups - Close Me If You Can",
	"Pumpkin Spice Girls - Wannabe Spooky",
];

function music(rng: Rng): Draft {
	const song = pickOne(rng, SONGS);
	return {
		kind: "music",
		title: "ClipAmp",
		icon: "ti-music",
		w: 300,
		h: 200,
		cls: "k-music",
		body: `
      <div class="deck">
        <div class="cover">${art("album")}${slot("left", `left:100%;top:${int(rng, 4, 38)}px;width:34px;height:30px;margin-left:2px`)}</div>
        <div class="lcd">
          <span class="clock px">0${int(rng, 0, 3)}:${String(int(rng, 10, 59))}</span>
          <div class="eq">${Array.from({ length: 12 }, (_, i) => `<i style="--d:${(0.3 + ((i * 37) % 10) / 14).toFixed(2)}s"></i>`).join("")}</div>
          <div class="title"><span>*** ${esc(song)} *** 128kbps 44kHz ***</span></div>
        </div>
      </div>
      <div class="transport">${["prev", "play", "pause", "stop", "next"].map((b) => `<span class="tb ${b}"></span>`).join("")}<div class="vol"><i style="width:${int(rng, 40, 90)}%"></i></div></div>
      <div class="playlist">${pickN(rng, SONGS, 3)
				.map(
					(s, i) =>
						`<span class="${s === song ? "on" : ""}">${i + 1}. ${esc(s)}</span>`,
				)
				.join("")}</div>`,
	};
}

const CHATS = [
	["xX_Kiro_Xx", "did u find him yet??"],
	["you", "no :( he's really good at this"],
	["xX_Kiro_Xx", "he's always in the last place u look lol"],
	["you", "that's how looking works"],
	["xX_Kiro_Xx", "try dragging stuff around"],
	["CoolDude98", "has anyone seen my stapler"],
	["you", "brb, checking behind the calculator"],
];

function chat(rng: Rng): Draft {
	const start = int(rng, 0, 2);
	const lines = CHATS.slice(start, start + 5);
	return {
		kind: "chat",
		title: "xX_Kiro_Xx - Instant Message",
		icon: "ti-chat",
		w: 300,
		h: 310,
		cls: "k-chat",
		body: `
      ${menu("File", "Edit", "Insert", "People")}
      <div class="convo">
        <div class="log">${lines.map(([who, text]) => `<p class="ln"><b class="${who === "you" ? "me" : "them"}">${esc(who)}:</b> ${esc(text)}</p>`).join("")}<p class="ln sys">CoolDude98 has signed on.</p></div>
        <div class="buddy"><i class="face nophoto"></i>${slot("up", "left:12px;top:8px;width:30px;height:30px")}<b>Buddy</b></div>
      </div>
      <div class="type"><span class="field">brb</span><span class="btn btn-sm">Send</span></div>`,
	};
}

const DOS = [
	"C:\\>dir clippy*.*",
	" Volume in drive C has no label",
	" File not found",
	"",
	'C:\\>find /i "clippy" *.*',
	"---------- HIDE.EXE: 3 matches",
	"",
	"C:\\>deltree /y popups",
	"Deleting popups...",
	"Access denied - a paper clip is using it",
	"",
	"C:\\>",
];

function terminal(rng: Rng): Draft {
	const skip = int(rng, 0, 4);
	return {
		kind: "terminal",
		title: "DOS Prompt",
		icon: "ti-dos",
		w: pickOne(rng, [380, 400]),
		h: 240,
		cls: "k-terminal",
		body: `<div class="tty">${esc(DOS.slice(skip).join("\n"))}<span class="caret"></span></div>`,
	};
}

const ERRORS: [string, string, string, string[]][] = [
	[
		"err",
		"Error",
		"A fatal exception 0E has occurred. Press any key to keep looking.",
		["OK"],
	],
	[
		"warn",
		"Warning",
		"Not enough memory to display this window. Display it anyway?",
		["Yes", "No"],
	],
	[
		"err",
		"hide.exe",
		"The file CLIPPY.EXE is being used by another program.",
		["OK"],
	],
	[
		"info",
		"Did you know?",
		"You can drag windows by their title bars to see what is behind them.",
		["OK"],
	],
	[
		"warn",
		"Paper Clip Detector",
		"A paper clip may be watching you.",
		["Ignore", "Panic"],
	],
	["err", "Error", "Keyboard not found. Press F1 to continue.", ["OK"]],
	[
		"ask",
		"Save changes?",
		"Do you want to save the changes to Document1?",
		["Yes", "No", "Cancel"],
	],
	["info", "Task Complete", "Task failed successfully.", ["OK"]],
	["ask", "Question", "Are you sure you want to stop looking?", ["Yes", "No"]],
];

/** A message box. `spec` overrides the random message. */
export function messageBox(
	rng: Rng,
	spec?: [string, string, string, string[]],
): Draft {
	const [icon, title, text, buttons] = spec ?? pickOne(rng, ERRORS);
	return {
		kind: "dialog",
		title,
		icon: `ti-${icon}`,
		w: 300,
		h: text.length > 60 ? 150 : 134,
		cls: "k-dialog",
		dialog: true,
		body: `
      <div class="msg"><span class="fw-icon ${icon}"></span><p>${esc(text)}</p></div>
      <div class="msg-btns">${buttons.map((b, i) => `<span class="btn btn-sm${i === 0 ? " btn-primary" : ""}" data-act="close">${esc(b)}</span>`).join("")}</div>`,
	};
}

function solitaire(rng: Rng): Draft {
	const suits = [
		["&spades;", ""],
		["&hearts;", "red"],
		["&clubs;", ""],
		["&diams;", "red"],
	];
	const ranks = [
		"A",
		"2",
		"3",
		"4",
		"5",
		"6",
		"7",
		"8",
		"9",
		"10",
		"J",
		"Q",
		"K",
	];
	const card = () => {
		const [s, c] = pickOne(rng, suits);
		return `<span class="card ${c}"><b>${pickOne(rng, ranks)}</b>${s}</span>`;
	};
	const peek = int(rng, 0, 5);
	const cols = Array.from({ length: 6 }, (_, i) => {
		const down = Math.min(i, 3);
		return `<div class="col">${i === peek ? slot("up", "left:9px;top:-29px;width:28px;height:28px") : ""}${'<span class="card back"></span>'.repeat(down)}${card()}${rng() < 0.5 ? card() : ""}</div>`;
	});
	return {
		kind: "solitaire",
		title: "Solitaire",
		icon: "ti-cards",
		w: 400,
		h: 310,
		cls: "k-solitaire",
		body: `
      ${menu("Game", "Help")}
      <div class="felt">
        <div class="toprow"><span class="card back deck">${slot("left", `left:100%;top:${int(rng, 4, 20)}px;width:34px;height:30px;margin-left:2px`)}</span><span class="card ghost"></span><span class="gap"></span><span class="card ghost"></span><span class="card ghost"></span>${card()}<span class="card ghost"></span></div>
        <div class="table">${cols.join("")}</div>
      </div>
      ${status(`Score: ${int(rng, 0, 400)}`, `Time: ${int(rng, 10, 900)}`)}`,
	};
}

function minesweeper(rng: Rng): Draft {
	const cells = Array.from({ length: 81 }, () => {
		const r = rng();
		if (r < 0.45) return '<span class="up"></span>';
		if (r < 0.5) return '<span class="up flag"></span>';
		if (r < 0.8) return "<span></span>";
		const n = int(rng, 1, 3);
		return `<span class="n${n}">${n}</span>`;
	});
	return {
		kind: "mines",
		title: "Minesweeper",
		icon: "ti-mine",
		w: 212,
		h: 290,
		cls: "k-mines",
		body: `
      ${menu("Game", "Help")}
      <div class="board">
        <div class="mhead"><span class="led px">0${int(rng, 10, 40)}</span><span class="smile"></span><span class="led px">${String(int(rng, 1, 999)).padStart(3, "0")}</span></div>
        <div class="minefield">${cells.join("")}</div>
      </div>`,
	};
}

function display(rng: Rng): Draft {
	const pic = pickOne(rng, ["hills", "beach", "pumpkins"]);
	return {
		kind: "display",
		title: "Display Properties",
		icon: "ti-props",
		w: 320,
		h: 330,
		cls: "k-display",
		dialog: true,
		body: `
      <div class="tabs"><span class="tab" aria-selected="true">Background</span><span class="tab">Screen Saver</span><span class="tab">Appearance</span></div>
      <div class="tab-panel">
        <div class="monitor"><div class="glass">${art(pic)}${slot("up", `left:${int(rng, 10, 120)}px;bottom:0;width:30px;height:30px`)}</div></div>
        <div class="wallpapers"><b>Wallpaper</b><span>(None)</span><span class="${pic === "hills" ? "sel" : ""}">Hills</span><span class="${pic === "beach" ? "sel" : ""}">Beach</span><span class="${pic === "pumpkins" ? "sel" : ""}">Pumpkins</span><span>Clouds</span></div>
      </div>
      <div class="msg-btns"><span class="btn btn-sm btn-primary" data-act="close">OK</span><span class="btn btn-sm" data-act="close">Cancel</span></div>`,
	};
}

const KINDS: Kind[] = [
	{ id: "browser", weight: 5, max: 8, make: browser },
	{ id: "viewer", weight: 2.5, max: 4, make: viewer },
	{ id: "video", weight: 2, max: 3, make: video },
	{ id: "notepad", weight: 2, max: 4, make: notepad },
	{ id: "paint", weight: 1.5, max: 2, make: paint },
	{ id: "explorer", weight: 2, max: 3, make: explorer },
	{ id: "calc", weight: 1, max: 2, make: calculator },
	{ id: "music", weight: 1.2, max: 2, make: music },
	{ id: "chat", weight: 1.5, max: 2, make: chat },
	{ id: "terminal", weight: 1, max: 2, make: terminal },
	{ id: "dialog", weight: 3, max: 8, make: (rng) => messageBox(rng) },
	{ id: "solitaire", weight: 1, max: 1, make: solitaire },
	{ id: "mines", weight: 1, max: 1, make: minesweeper },
	{ id: "display", weight: 1, max: 1, make: display },
];

/**
 * Drafts windows for one pile until `full(drafts)` says it is deep enough.
 * Kinds are picked by weight up to their per-pile maximum, starting with one
 * of every kind so each pile shows the whole variety when there is room.
 */
export function draftPile(rng: Rng, full: (drafts: Draft[]) => boolean) {
	siteDeck = [];
	const drafts: Draft[] = [];
	const count = new Map<string, number>();
	const add = (kind: Kind) => {
		drafts.push(kind.make(rng));
		count.set(kind.id, (count.get(kind.id) ?? 0) + 1);
	};
	for (const kind of shuffle(rng, KINDS)) {
		if (full(drafts)) break;
		add(kind);
	}
	while (!full(drafts)) {
		const open = KINDS.filter((k) => (count.get(k.id) ?? 0) < k.max);
		if (!open.length) break;
		let roll = rng() * open.reduce((sum, k) => sum + k.weight, 0);
		let kind = open[open.length - 1];
		for (const k of open) {
			roll -= k.weight;
			if (roll < 0) {
				kind = k;
				break;
			}
		}
		add(kind);
	}
	return shuffle(rng, drafts);
}

/** A cheeky message box that appears when the player closes a window. */
export function closePopup(rng: Rng, depth: number): Draft {
	const lines: [string, string, string, string[]][] = depth
		? [
				[
					"ask",
					"Clippy",
					"It looks like you're trying to close the window about closing windows!",
					["Yes", "Also yes"],
				],
				[
					"warn",
					"Clippy",
					"Closing windows only makes more windows. Did you know that?",
					["Now I do"],
				],
			]
		: [
				[
					"ask",
					"Clippy",
					"It looks like you're trying to close a window! Would you like help?",
					["Yes", "No"],
				],
				[
					"info",
					"Clippy",
					"Are you sure? That window had feelings.",
					["Sorry", "OK"],
				],
				[
					"warn",
					"Clippy",
					"Closing windows won't find me, you know.",
					["Hmph"],
				],
				[
					"ask",
					"Clippy",
					"Would you like to save this window for later?",
					["Yes", "No", "Maybe"],
				],
			];
	const draft = messageBox(rng, pickOne(rng, lines));
	draft.kind = "popup";
	draft.icon = "ti-clippy";
	return draft;
}
