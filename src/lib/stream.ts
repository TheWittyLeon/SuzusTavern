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

import { makeApiError } from './api/client';
import type {
  BusyResult,
  DmNarrationRequest,
  DmTurnRequest,
  GenerationJobHandle,
  NarrationEvent,
  NarrationRequest,
} from './api/types';

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
      const chunk: NarrationEvent = { kind: 'chunk', text: parsed['text'] as string };

      // A.2 reconciliation — parse the two optional fields the server's INTENT
      // classifier attaches (NN narration.py + core/intent_router.py, confirmed
      // shipped contract). Defensive: an unexpected/malformed shape is simply
      // dropped, never thrown — presence is a bonus, never a requirement, so
      // today's behaviour (no fields) is unchanged.
      const offered = parsed['offered_check'];
      if (
        offered &&
        typeof offered === 'object' &&
        typeof (offered as Record<string, unknown>)['skill'] === 'string'
      ) {
        const o = offered as Record<string, unknown>;
        chunk.offeredCheck = {
          skill: o['skill'] as string,
          ...(typeof o['dc'] === 'number' ? { dc: o['dc'] as number } : {}),
        };
      }

      if (typeof parsed['scene_advanced'] === 'boolean') {
        chunk.sceneAdvanced = parsed['scene_advanced'];
        const advancedTo = parsed['advanced_to'];
        if (typeof advancedTo === 'string' || advancedTo === null) {
          chunk.advancedTo = advancedTo;
        }
      }

      // DM-STREAM — additive: surface the server's stream_mode marker so the
      // consumer knows this beat is already being paced server-side (chunk
      // events carry cumulative text either way; this only changes how the
      // consumer reveals it — see page.tsx narrate()).
      if (parsed['stream_mode'] === true) {
        chunk.streamMode = true;
      }

      return chunk;
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
 * DDX-20 — durable turn create/dedup (flag-ON only, DURABLE_GENERATION_ENABLED).
 * POST /api/narration/dm/turn.
 *
 * Bespoke fetch — deliberately NOT `apiCall` — because `apiCall<T>` THROWS on
 * any `{success:false}` envelope, including the 409 `generation_in_progress`
 * busy shape (P2 Design Delta §2.4). A thrown 409 would turn the
 * 409-subscribe-pivot (Client Integration Design §4a) into an exception
 * path; this returns a typed `BusyResult` instead so the caller can pivot
 * cleanly to subscribing the in-flight job. Any OTHER non-2xx status still
 * throws — 409 is the only status this function treats as a real (non-error)
 * outcome.
 */
export async function postDmTurn(
  payload: DmTurnRequest,
  options: ReadSSEOptions = {},
): Promise<GenerationJobHandle | BusyResult> {
  const { signal } = options;

  let res: Response;
  try {
    res = await fetch('/api/narration/dm/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw makeApiError(0, 'abort');
    }
    throw makeApiError(0, 'network');
  }

  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body — body stays undefined; handled by the generic-error
    // branch below (still throws, using the raw HTTP status as the code).
  }

  if (res.status === 409) {
    const data = (body?.['data'] as Record<string, unknown> | undefined) ?? {};
    return {
      busy: true,
      job_id: typeof data['job_id'] === 'string' ? (data['job_id'] as string) : '',
      status: data['status'] === 'pending' ? 'pending' : 'streaming',
      trigger_seq: typeof data['trigger_seq'] === 'number' ? (data['trigger_seq'] as number) : 0,
    };
  }

  if (!res.ok || body?.['success'] !== true) {
    const code =
      typeof body?.['error'] === 'string'
        ? (body['error'] as string)
        : typeof body?.['reason'] === 'string'
          ? (body['reason'] as string)
          : String(res.status);
    throw makeApiError(res.status, code, body);
  }

  const data = (body['data'] as Record<string, unknown>) ?? {};
  return {
    job_id: typeof data['job_id'] === 'string' ? (data['job_id'] as string) : '',
    turn_key: typeof data['turn_key'] === 'string' ? (data['turn_key'] as string) : payload.turn_key,
    status:
      data['status'] === 'final' || data['status'] === 'streaming' ? data['status'] : 'pending',
    deduped: data['deduped'] === true,
  };
}

/**
 * DDX-20 — subscribe to a durable job's SSE tail (live accelerator / resume,
 * Client Integration Design §6). GET /api/narration/dm/stream?job_id=.
 * Reuses `readSSE` — the BFF's SSE-passthrough branch for this sub-path is
 * unchanged, so the wire format (chunk/done/error) matches
 * `streamDmNarration` exactly.
 */
export async function* subscribeDmJob(
  jobId: string,
  options: ReadSSEOptions = {},
): AsyncIterableIterator<NarrationEvent> {
  const { signal } = options;
  if (signal?.aborted) return;

  let res: Response;
  try {
    res = await fetch(`/api/narration/dm/stream?job_id=${encodeURIComponent(jobId)}`, {
      method: 'GET',
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
