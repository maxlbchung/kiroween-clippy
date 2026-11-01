// LLM adapters. Each keeps the conversation in its own wire format and offers:
//   step(signal)      async generator: yields text, returns [{ id, name, input, error? }]
//   addResults(list)  [{ id, text, image?, isError? }] for the calls just returned
import Anthropic from '@anthropic-ai/sdk';

const MAX_TOKENS = 64000;
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/;

function anthropicProvider({ apiKey, model, system, tools, history }) {
  const client = new Anthropic({ apiKey });
  // Append-only: Claude's thinking blocks are rejected if earlier turns change.
  const messages = [...history];
  const defs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema, eager_input_streaming: true }));
  const fallback = FALLBACK_MODELS.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};

  return {
    async *step(signal) {
      const stream = client.beta.messages.stream(
        { model, max_tokens: MAX_TOKENS, system, tools: defs, messages, cache_control: { type: 'ephemeral' }, ...fallback },
        { signal },
      );
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('The model declined this request.');
      if (msg.stop_reason === 'max_tokens') throw new Error('The model ran out of room mid-reply.');
      messages.push({ role: 'assistant', content: msg.content });
      return msg.content.filter((b) => b.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input }));
    },
    addResults(results) {
      messages.push({
        role: 'user',
        content: results.map(({ id, text, image, isError }) => ({
          type: 'tool_result',
          tool_use_id: id,
          is_error: !!isError,
          content: image
            ? [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }]
            : text,
        })),
      });
    },
  };
}

/** Yields the JSON payload of each server-sent event in a fetch body. */
export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.match(/^data:\s*(.*)$/)?.[1]?.trim();
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

function openaiProvider({ apiKey, baseUrl, model, system, tools, history }) {
  const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
  const messages = [{ role: 'system', content: system }, ...history];
  const defs = tools.map(({ name, description, input_schema }) => ({ type: 'function', function: { name, description, parameters: input_schema } }));

  return {
    async *step(signal) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: defs, stream: true }),
        signal,
      });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { msg = (await res.json())?.error?.message || msg; } catch { /* keep status */ }
        throw new Error(msg);
      }
      let content = '';
      let finish = null;
      const calls = [];
      for await (const ev of sseEvents(res.body)) {
        const choice = ev.choices?.[0];
        if (!choice) continue;
        finish = choice.finish_reason || finish;
        if (choice.delta?.content) {
          content += choice.delta.content;
          yield choice.delta.content;
        }
        for (const c of choice.delta?.tool_calls || []) {
          const call = (calls[c.index ?? 0] ??= { id: '', name: '', args: '' });
          call.id ||= c.id || '';
          call.name ||= c.function?.name || '';
          call.args += c.function?.arguments || '';
        }
      }
      if (finish === 'length') throw new Error('The model ran out of room mid-reply.');
      messages.push({
        role: 'assistant',
        content: content || null,
        ...(calls.length && {
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
        }),
      });
      return calls.map((c) => {
        try {
          return { id: c.id, name: c.name, input: JSON.parse(c.args || '{}') };
        } catch {
          return { id: c.id, name: c.name, input: {}, error: 'Tool arguments were not valid JSON.' };
        }
      });
    },
    addResults(results) {
      for (const { id, text } of results) messages.push({ role: 'tool', tool_call_id: id, content: text });
      // Tool messages can't carry images in this format.
      for (const { image } of results) {
        if (image) messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }] });
      }
    },
  };
}

export const createProvider = ({ provider, ...opts }) =>
  (provider === 'anthropic' ? anthropicProvider(opts) : openaiProvider(opts));
