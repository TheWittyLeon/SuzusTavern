// src/lib/stream.ts
//
// SSE reader for narration streams. DOM/Web-Streams based — no Node.js APIs.
// Runs in the browser only.
//
// Wire format (from api/routes/narration.py):
//   data: {"success":true,"text":"..."}\n\n
//   data: {"success":false,"error":"..."}\n\n
//   data: [DONE]\n\n
//
// ST-007

import type { DmNarrationRequest, NarrationEvent, NarrationRequest } from './api/types';

export interface ReadSSEOptions {
  signal?: AbortSignal;
}

/**
 * Read a fetch() Response body as Server-Sent Events.
 *
 * Parses `data:` lines, concatenates multi-line data per SSE spec,
 * yields typed NarrationEvent. Ignores blank lines, `event:`, `id:`, `retry:`.
 *
 * Cancellation: if signal.aborted, cancels the underlying reader and returns.
 * AbortError is swallowed — the caller gets a clean return with no final event.
 */
export async function* readSSE(
  res: Response,
  options: ReadSSEOptions = {},
): AsyncIterableIterator<NarrationEvent> {
  const { signal } = options;
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // Pending multi-line data accumulator (SSE spec §9.2.6)
  let dataBuffer = '';
  // Incomplete line carry-over from previous chunk
  let lineCarry = '';

  const cleanup = () => {
    reader.cancel().catch(() => {/* swallow */});
  };

  // Abort handler — cancel the reader then let the loop exit naturally
  if (signal) {
    if (signal.aborted) {
      cleanup();
      return;
    }
    signal.addEventListener('abort', cleanup, { once: true });
  }

  try {
    while (true) {
      // Check abort before each read
      if (signal?.aborted) break;

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        // AbortError from reader.cancel() triggered by the signal listener — swallow
        if (err instanceof DOMException && err.name === 'AbortError') break;
        throw err;
      }
      if (done) break;

      // Decode this chunk and prepend any leftover from prior chunk
      const chunk = lineCarry + decoder.decode(value, { stream: true });
      lineCarry = '';

      // Split on newlines — SSE uses \n or \r\n
      const lines = chunk.split(/\r?\n/);

      // The last element may be an incomplete line — carry it over
      const last = lines.pop();
      lineCarry = last ?? '';

      for (const line of lines) {
        if (line === '') {
          // Blank line = event dispatch boundary
          if (dataBuffer !== '') {
            const raw = dataBuffer;
            dataBuffer = '';
            yield parseDataLine(raw);
          }
          continue;
        }

        if (line.startsWith('data:')) {
          // Strip the "data:" prefix; leading space is optional per spec
          const value = line.slice(5).replace(/^ /, '');
          // Multi-line data: append with newline per spec
          dataBuffer = dataBuffer === '' ? value : dataBuffer + '\n' + value;
        }
        // `event:`, `id:`, `retry:` — ignored for v1
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', cleanup);
    reader.cancel().catch(() => {/* swallow — may already be cancelled */});
  }
}

/** Parse a completed SSE data payload into a NarrationEvent. */
function parseDataLine(data: string): NarrationEvent {
  // Sentinel — stream complete
  if (data.trim() === '[DONE]') {
    return { kind: 'done' };
  }
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed['success'] === true && typeof parsed['text'] === 'string') {
      return { kind: 'chunk', text: parsed['text'] as string };
    }
    if (parsed['success'] === false && typeof parsed['error'] === 'string') {
      const reason =
        typeof parsed['reason'] === 'string' ? (parsed['reason'] as string) : undefined;
      return { kind: 'error', error: parsed['error'] as string, ...(reason ? { reason } : {}) };
    }
    // Unexpected shape — treat as error
    return { kind: 'error', error: `Unexpected event shape: ${data}` };
  } catch {
    return { kind: 'error', error: `JSON parse error: ${data}` };
  }
}

/**
 * Convenience: POST to /api/narration/stream, then iterate the SSE response.
 *
 *   for await (const ev of streamNarration(payload)) { ... }
 *
 * Single-attempt only. Auto-reconnect with exponential backoff is deferred to
 * Sprint 7 once the play screen knows what "resume from where" means. A thin
 * `streamNarrationWithRetry` wrapper will be added at that point.
 *
 * On non-2xx: yields {kind:'error'} then returns.
 * On network error: yields {kind:'error', error:'network'} then returns.
 * On abort: returns silently.
 */
export async function* streamNarration(
  payload: NarrationRequest,
  options: ReadSSEOptions = {},
): AsyncIterableIterator<NarrationEvent> {
  const { signal } = options;

  if (signal?.aborted) return;

  let res: Response;
  try {
    res = await fetch('/api/narration/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    yield { kind: 'error', error: 'network' };
    return;
  }

  if (!res.ok) {
    let errorText = `HTTP ${res.status}`;
    try {
      const body = await res.json() as Record<string, unknown>;
      if (typeof body['error'] === 'string') errorText = body['error'] as string;
    } catch {
      // non-JSON error body — use status string
    }
    yield { kind: 'error', error: errorText };
    return;
  }

  yield* readSSE(res, options);
}

/**
 * DM-narration stream (ST-062): POST /api/narration/dm/stream, iterate the SSE.
 *
 *   for await (const ev of streamDmNarration(payload, { signal })) { ... }
 *
 * Same wire format + error/abort semantics as streamNarration — the only
 * difference is the endpoint (dedicated Suzu-DM pipeline) and the richer body
 * (mechanics/transcript). The engine owns mechanical truth; this only narrates it.
 */
export async function* streamDmNarration(
  payload: DmNarrationRequest,
  options: ReadSSEOptions = {},
): AsyncIterableIterator<NarrationEvent> {
  const { signal } = options;
  if (signal?.aborted) return;

  let res: Response;
  try {
    res = await fetch('/api/narration/dm/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    yield { kind: 'error', error: 'network' };
    return;
  }

  if (!res.ok) {
    let errorText = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body['error'] === 'string') errorText = body['error'] as string;
    } catch {
      // non-JSON error body — use status string
    }
    yield { kind: 'error', error: errorText };
    return;
  }

  yield* readSSE(res, options);
}
