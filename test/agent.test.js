import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/main/agent.js';
import { createTools, htmlToText, parseSearchResults } from '../src/main/tools.js';

const sse = (events) => new Response(events.map((e) => `event: ${e.type ?? 'message'}\ndata: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', {
  headers: { 'content-type': 'text/event-stream' },
});

/** Replaces fetch with scripted responses; records each request body. */
function scriptFetch(t, responses) {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return responses.shift()();
  });
  return bodies;
}

const makeAgent = (provider, ran, extra = {}) => createAgent({
  settings: {
    data: { ai: { provider, baseUrl: '', chatModel: 'test-model', directModel: 'test-fast' } },
    hasSecret: () => true,
    getSecret: async () => 'key',
  },
  tools: [{
    name: 'echo',
    description: 'echo',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async (input) => { ran.push(input.text); return extra.image ? { text: 'shot', image: 'AAAA' } : 'echoed'; },
  }],
});

async function collect(gen) {
  const out = { text: '', steps: [] };
  for await (const e of gen) {
    if (e.type === 'delta') out.text += e.text;
    else out.steps.push(e.label);
  }
  return out;
}

const openaiToolTurn = (args) => () => sse([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'echo', arguments: args.slice(0, 3) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(3) } }] }, finish_reason: 'tool_calls' }] },
]);
const openaiText = (text) => () => sse([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }]);

test('openai format: runs split tool calls and feeds the result back', async (t) => {
  const bodies = scriptFetch(t, [openaiToolTurn('{"text":"hi"}'), openaiText('done')]);
  const ran = [];
  const out = await collect(makeAgent('openai', ran).chat([{ role: 'user', content: 'go' }]));
  assert.deepEqual(ran, ['hi']);
  assert.equal(out.text, 'done');
  assert.deepEqual(out.steps, ['echo: hi']);
  assert.deepEqual(bodies[1].messages.at(-1), { role: 'tool', tool_call_id: 'c1', content: 'echoed' });
});

test('openai format: images follow the tool message as a user message', async (t) => {
  const bodies = scriptFetch(t, [openaiToolTurn('{"text":"hi"}'), openaiText('done')]);
  await collect(makeAgent('openai', [], { image: true }).chat([{ role: 'user', content: 'go' }]));
  assert.equal(bodies[1].messages.at(-1).content[0].image_url.url, 'data:image/jpeg;base64,AAAA');
});

test('bad tool input comes back as a tool error without running', async (t) => {
  const bodies = scriptFetch(t, [openaiToolTurn('{"nope":true}'), openaiText('ok')]);
  const ran = [];
  await collect(makeAgent('openai', ran).chat([{ role: 'user', content: 'go' }]));
  assert.deepEqual(ran, []);
  assert.match(bodies[1].messages.at(-1).content, /Missing required input: text/);
});

test('stop aborts the run before the next tool', async (t) => {
  scriptFetch(t, [openaiToolTurn('{"text":"hi"}')]);
  const ran = [];
  const agent = makeAgent('openai', ran);
  const gen = agent.chat([{ role: 'user', content: 'go' }]);
  await gen.next(); // step announced, tool not started
  agent.stop();
  await assert.rejects(collect(gen), { name: 'AbortError' });
});

test('anthropic format: appends tool results after the assistant turn', async (t) => {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const message = (stop_reason) => ({ id: 'm', type: 'message', role: 'assistant', model: 'test-model', content: [], stop_reason, stop_sequence: null, usage });
  const bodies = scriptFetch(t, [
    () => sse([
      { type: 'message_start', message: message(null) },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'echo', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"hi"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]),
    () => sse([
      { type: 'message_start', message: message(null) },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]),
  ]);
  const ran = [];
  const out = await collect(makeAgent('anthropic', ran).chat([{ role: 'user', content: 'go' }]));
  assert.deepEqual(ran, ['hi']);
  assert.equal(out.text, 'done');
  const [, assistant, results] = bodies[1].messages;
  assert.equal(assistant.content[0].type, 'tool_use');
  assert.equal(results.content[0].tool_use_id, 't1');
  assert.equal(results.content[0].content, 'echoed');
});

test('missing key is a clear error', async () => {
  const agent = createAgent({ settings: { data: { ai: { provider: 'anthropic' } }, getSecret: async () => '' }, tools: [] });
  await assert.rejects(collect(agent.chat([])), /API key/);
});

test('run_command returns plain text, including errors', { skip: process.platform !== 'win32' }, async () => {
  const tool = createTools({}).find((t) => t.name === 'run_command');
  const out = await tool.run({ command: 'Write-Output hello; Write-Error oops' }, { signal: new AbortController().signal });
  assert.match(out, /hello/);
  assert.match(out, /oops/);
  assert.doesNotMatch(out, /CLIXML/);
});

test('search results unwrap redirect links', () => {
  const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Ex <b>ample</b></a>
    <a class="result__snippet" href="x">A &amp; B</a>`;
  assert.deepEqual(parseSearchResults(html), ['Ex ample\nhttps://example.com/a\nA & B']);
});

test('htmlToText drops scripts and keeps blocks apart', () => {
  assert.equal(htmlToText('<script>x()</script><p>one</p><p>two &amp; three</p>'), 'one\ntwo & three');
});
