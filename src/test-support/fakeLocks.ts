// Test helpers for navigator.locks (Node 24 ships a real one, jsdom has none).
// `removeLocks()` = the "navigator.locks missing" browser; `installFakeLocks()` = a controllable one that
// serialises per name and honours `signal` while queued, like the real API.

function setLocks(value: unknown): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value, configurable: true, writable: true });
}

export function removeLocks(): void {
  setLocks(undefined);
}

export interface FakeLocks {
  /** Names requested, in order. */
  requests: string[];
  /** Resolve a callback currently holding `name` only when released (default: held until cb settles). */
  uninstall(): void;
}

export function installFakeLocks(): FakeLocks {
  const tails = new Map<string, Promise<unknown>>();
  const requests: string[] = [];
  setLocks({
    request(name: string, opts: { signal?: AbortSignal }, cb: () => Promise<unknown>) {
      requests.push(name);
      const prev = tails.get(name) ?? Promise.resolve();
      const run = new Promise((resolve, reject) => {
        const signal = opts?.signal;
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        void prev.then(async () => {
          signal?.removeEventListener('abort', onAbort);
          if (aborted) return;
          try {
            resolve(await cb());
          } catch (e) {
            reject(e);
          }
        });
      });
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  });
  return { requests, uninstall: removeLocks };
}
