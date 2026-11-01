// Everything the agent can do on this PC. Each tool's run() returns a string,
// or { text, image } when it also has a JPEG (base64) to show the model.
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 12000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

const clip = (s, max = MAX_OUTPUT) => (s.length > max ? `${s.slice(0, max)}\n[truncated, ${s.length - max} more characters]` : s);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
const decode = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

export function htmlToText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function parseSearchResults(html) {
  const results = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, href, title, snippet] of html.matchAll(re)) {
    const target = new URL(decode(href), 'https://duckduckgo.com').searchParams.get('uddg') || decode(href);
    results.push(`${htmlToText(title)}\n${target}\n${htmlToText(snippet)}`);
  }
  return results;
}

// ponytail: scrapes DuckDuckGo's HTML page so every provider shares one search;
// swap in a paid search API if it starts rate limiting.
async function webSearch({ query }, { signal }) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const results = parseSearchResults(await res.text());
  return results.length ? results.slice(0, 8).join('\n\n') : 'No results. Try fetch_url on a site you know.';
}

async function fetchUrl({ url }, { signal }) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.text();
  return clip(/html/i.test(res.headers.get('content-type') || '') ? htmlToText(body) : body);
}

function runCommand({ command, timeout_seconds = 60 }, { signal }) {
  return new Promise((resolve, reject) => {
    const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${command}`;
    // Base64 avoids quoting issues; -EncodedCommand itself would wrap stderr in CLIXML.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command',
        `Invoke-Expression ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')))`],
      { windowsHide: true, cwd: process.env.USERPROFILE, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    const add = (d) => { output = (output + d).slice(-MAX_OUTPUT * 2); };
    proc.stdout.on('data', add);
    proc.stderr.on('data', add);
    const kill = () => proc.kill();
    const timer = setTimeout(kill, Math.min(timeout_seconds, 300) * 1000);
    signal.addEventListener('abort', kill, { once: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
      resolve(clip(`exit code: ${code ?? 'killed'}\n${output.trim()}`));
    });
  });
}

const str = { type: 'string' };
const int = { type: 'integer' };
const ref = { ...int, description: 'Element number from read_window.' };
const windowId = { ...int, description: 'Window id from list_windows.' };
const button = { type: 'string', enum: ['left', 'right'] };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function createTools({ uia, pet }) {
  const act = (cmd) => (input) => uia.call(cmd, input);
  return [
    {
      name: 'list_windows',
      description: 'List open top-level windows with their ids, titles and processes. Clippy\'s own windows are hidden.',
      input_schema: schema({}),
      run: async () => JSON.stringify(await uia.call('windows')),
    },
    {
      name: 'read_window',
      description: 'Read a window\'s UI Automation tree as indented text, one "[n] Role "name" value=... (state)" line per element. Use the numbers with click, type_text, scroll and point_at. Numbers stay valid until the UI changes. Pass query to list only elements whose name or value contains that text; use it for large windows.',
      input_schema: schema({ window: windowId, query: str }, ['window']),
      run: async ({ window, query }) => (await uia.call('read', { window, query })) || 'No matching elements. The app may expose little to UI Automation; try screenshot.',
    },
    {
      name: 'focus_window',
      description: 'Bring a window to the front. Needed before press_keys, and before type_text without an element.',
      input_schema: schema({ window: windowId }, ['window']),
      run: act('focus'),
    },
    {
      name: 'click',
      description: 'Click an element from read_window. Works without moving the mouse where the app allows it.',
      input_schema: schema({ ref, button, double: { type: 'boolean' } }, ['ref']),
      run: act('click'),
    },
    {
      name: 'type_text',
      description: 'With ref: replace that field\'s whole value, or focus it and type where it has no settable value. Without ref: type at the current focus. Newlines press Enter.',
      input_schema: schema({ text: str, ref }, ['text']),
      run: act('type'),
    },
    {
      name: 'press_keys',
      description: 'Press keys in the foreground window. Combos joined with +, separated by spaces, e.g. "ctrl+l", "alt+tab", "down down enter".',
      input_schema: schema({ keys: str }, ['keys']),
      run: act('keys'),
    },
    {
      name: 'scroll',
      description: 'Scroll with the mouse wheel over an element, or at the current mouse position without ref.',
      input_schema: schema({ direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: int, ref }, ['direction']),
      run: act('scroll'),
    },
    {
      name: 'screenshot',
      description: 'See the monitor showing a window (primary monitor without one). Use when read_window shows too little, as in games, canvases and some web content, or to check a visual result.',
      input_schema: schema({ window: windowId }),
      run: async ({ window }) => {
        const shot = await uia.call('screenshot', { window });
        return { text: `Screenshot ${shot.width}x${shot.height}. click_at uses these pixels.`, image: shot.data };
      },
    },
    {
      name: 'click_at',
      description: 'Click pixel coordinates in the most recent screenshot. Use only when no read_window element fits.',
      input_schema: schema({ x: int, y: int, button, double: { type: 'boolean' } }, ['x', 'y']),
      run: act('click_at'),
    },
    {
      name: 'point_at',
      description: 'Walk Clippy over to an element and show a short tip beside it. For when the user asks to be shown how to do something: point, then wait for them instead of clicking.',
      input_schema: schema({ ref, tip: str }, ['ref', 'tip']),
      run: async ({ ref: id, tip }) => {
        pet.pointAt(await uia.call('rect', { ref: id }), tip);
        return 'pointing';
      },
    },
    {
      name: 'run_command',
      description: 'Run PowerShell on this PC and get its output. Use for files, launching apps (Start-Process), the clipboard, system info and anything scriptable. Starts in the user\'s home folder.',
      input_schema: schema({ command: str, timeout_seconds: int }, ['command']),
      run: runCommand,
    },
    {
      name: 'web_search',
      description: 'Search the web. Returns titles, links and snippets.',
      input_schema: schema({ query: str }, ['query']),
      run: webSearch,
    },
    {
      name: 'fetch_url',
      description: 'Download a web page as plain text.',
      input_schema: schema({ url: str }, ['url']),
      run: fetchUrl,
    },
  ];
}
