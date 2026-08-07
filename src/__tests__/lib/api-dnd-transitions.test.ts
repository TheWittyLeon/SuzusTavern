/**
 * @jest-environment node
 *
 * Grounding transition projection (2026-08-06).
 *
 * Authored transitions carry fields the player must never receive:
 *   - `note` — GM-facing prose. hollow-tide-cave's back_chamber exit says
 *     "Also auto-fires if krell_bargained flag is set without combat."
 *   - `requires` — the flag gate, ALREADY applied server-side by
 *     `engine/beats.py::transition_available` (stripped from grounding by
 *     `routes/sessions.py`). Shipping it only invites a client-side re-filter,
 *     which would diverge from the transition list the narrator was given.
 *
 * `checks` next door has been projected field-by-field for exactly this reason
 * since P1-PLAYFIX; `transitions` was a raw `as SceneTransition[]` cast.
 *
 * SCOPE — stated precisely, because the first version of this file overstated
 * it (Kage-CR C1, 2026-08-07). `normalizeGrounding` runs in the BROWSER, after
 * the response is already in the network tab, and the BFF
 * (`src/app/api/dnd/[...path]/route.ts`) is a byte pass-through. So this
 * projection does NOT take the note off the wire — it keeps it out of client
 * state, devtools and error reports. The wire fix is server-side and is filed
 * as TACTICS-WIRE-SIBLINGS.
 *
 * These tests assert on the OMISSION, which is the part that silently breaks —
 * and they assert it over the WHOLE payload. Scoped to `g.transitions` alone
 * they passed while the raw `current_scene.transitions` rode along in the
 * `...r` spread, i.e. while the projection removed nothing at all.
 */
import { getGrounding } from '@/lib/api/dnd';

// Same harness as api-dnd.test.ts: stub global.fetch with a real Response.
const mockFetch = jest.fn();
const respond = (payload: unknown) =>
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

/** The engine's real grounding shape, with an authored transition carrying
 *  every field a scene author can write. */
function groundingPayload() {
  return {
    success: true,
    data: {
      adventure: { title: 'The Hollow Tide Cave', hook: 'A missing crew.' },
      current_scene: {
        id: 'back_chamber',
        title: 'The Back Chamber',
        boxed_text: 'Salt water pools around your boots.',
        objective: 'Free the crew.',
        transitions: [
          {
            to: 'exit',
            label: 'Lead the crew out',
            auto: true,
            requires_encounter_resolved: 'krell_band',
            note: 'Also auto-fires if krell_bargained flag is set without combat.',
          },
          {
            to: 'exit',
            label: 'Negotiate Krell out',
            auto: false,
            requires: ['krell_bargained'],
          },
        ],
        checks: [],
        opening_lines: [],
      },
      campaign: { progress: { flags: { krell_bargained: true }, encounter_state: {} } },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  (global as unknown as Record<string, unknown>).fetch = mockFetch;
  respond(groundingPayload());
});

describe('getGrounding — transition projection', () => {
  it('keeps the fields the UI actually renders', async () => {
    const g = await getGrounding('s1');
    expect(g?.transitions).toHaveLength(2);
    expect(g?.transitions?.[0]).toMatchObject({ to: 'exit', label: 'Lead the crew out' });
    expect(g?.transitions?.[1]).toMatchObject({ to: 'exit', label: 'Negotiate Krell out' });
  });

  it('keeps requires_encounter_resolved — the ONE gate that is still client-side', async () => {
    const g = await getGrounding('s1');
    // engine/beats.py does not evaluate this one, so the play page must.
    expect(g?.transitions?.[0].requires_encounter_resolved).toBe('krell_band');
    expect(g?.transitions?.[1]).not.toHaveProperty('requires_encounter_resolved');
  });

  it('DROPS the GM-facing `note` — from the WHOLE payload, not just transitions', async () => {
    const g = await getGrounding('s1');
    for (const t of g?.transitions ?? []) expect(t).not.toHaveProperty('note');
    // Kage-CR C1 (2026-08-07): this assertion used to be scoped to
    // `g.transitions`, which made it read as proof while the raw
    // `current_scene.transitions` — still carrying `note` — rode along in the
    // `...r` spread. Scoped to the whole object it went RED, which is how the
    // defect was found. Keep it whole-object.
    expect(JSON.stringify(g)).not.toMatch(/auto-fires|krell_bargained flag/i);
  });

  it('DROPS the raw current_scene / campaign blobs that defeated the projection', async () => {
    const g = await getGrounding('s1');
    // The include list built a NEW top-level `transitions`; the raw nested
    // copies had to stop being re-spread or it removed nothing at all.
    expect(g).not.toHaveProperty('current_scene');
    expect(g).not.toHaveProperty('campaign');
    // The flat fields those blobs were normalized INTO must survive.
    expect(g?.scene_id).toBe('back_chamber');
    expect(g?.flags).toEqual({ krell_bargained: true });
  });

  it('DROPS `requires` — from the whole payload, engine already applied it', async () => {
    const g = await getGrounding('s1');
    for (const t of g?.transitions ?? []) expect(t).not.toHaveProperty('requires');
    // NOT a bare /krell_bargained/ over the whole payload — that flag name
    // legitimately appears in `grounding.flags`, which the play page needs.
    // What must not survive is the transition's own `requires` ARRAY.
    expect(JSON.stringify(g?.transitions)).not.toMatch(/requires"\s*:/);
    expect(JSON.stringify(g?.transitions)).not.toMatch(/krell_bargained/);
  });

  it('is an INCLUDE list: a newly authored field defaults to omitted', async () => {
    // The regression that matters is someone "simplifying" this back to a
    // spread. A future authoring field must not ride along by default.
    const payload = groundingPayload();
    (payload.data.current_scene.transitions[0] as Record<string, unknown>).dm_only_future_field =
      'secret tactical intent';
    respond(payload);

    const g = await getGrounding('s1');
    expect(g?.transitions?.[0]).not.toHaveProperty('dm_only_future_field');
    expect(JSON.stringify(g)).not.toMatch(/secret tactical intent/);
    // Exactly the allowed keys, nothing more.
    expect(Object.keys(g!.transitions![0]).sort()).toEqual(
      ['label', 'requires_encounter_resolved', 'to'].sort(),
    );
  });

  it('omits absent optionals entirely rather than emitting undefined keys', async () => {
    const g = await getGrounding('s1');
    expect(Object.keys(g!.transitions![1]).sort()).toEqual(['label', 'to']);
  });
});
