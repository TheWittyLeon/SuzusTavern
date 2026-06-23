// A3 -- NOTABLE set updated to real engine event kinds.
// Tests that real msm engine event kinds surface in buildRecap.
// Kept in a separate file to avoid SWC curly-quote interaction with recap.test.ts.
import { buildRecap } from "@/lib/dnd/recap";
import type { Session, SessionEvent } from "@/lib/api/types";

const base: Session = {
  session_id: "s1",
  channel: "the_hollow_tide",
  status: "paused",
  dm_username: "suzu",
  player_count: 3,
  started_at: "2026-06-14T20:00:00Z",
};

describe("A3 - NOTABLE set matches real engine event kinds", () => {
  it("scene_advance with description surfaces in the recap", () => {
    const events: SessionEvent[] = [
      { event_type: "session_start", description: "Session started." },
      { event_type: "scene_advance", description: "The party moved deeper into the cave." },
    ];
    const r = buildRecap(base, events);
    expect(r.empty).toBe(false);
    expect(r.headline).toBe("Previously on…");
    expect(r.lines).toContain("The party moved deeper into the cave.");
  });

  it("encounter_resolved with description surfaces in the recap", () => {
    const events: SessionEvent[] = [
      { event_type: "encounter_resolved", description: "The goblins were defeated." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("The goblins were defeated.");
    expect(r.facts).toContain("goblins");
  });

  it("xp_award with description surfaces in the recap", () => {
    const events: SessionEvent[] = [
      { event_type: "xp_award", description: "The party earned 200 XP." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("The party earned 200 XP.");
  });

  it("level_up (real engine kind) surfaces in the recap", () => {
    const events: SessionEvent[] = [
      { event_type: "level_up", description: "Velka reached level 2." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("Velka reached level 2.");
  });

  it("session_end with description surfaces in the recap", () => {
    const events: SessionEvent[] = [
      { event_type: "session_end", description: "The session ended with the party at the cave mouth." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("The session ended with the party at the cave mouth.");
  });

  it("scene_advance and encounter_resolved preferred over unrecognised kinds", () => {
    const events: SessionEvent[] = [
      { event_type: "join", description: "Velka joined." },
      { event_type: "unknown_future_kind", description: "Something happened." },
      { event_type: "scene_advance", description: "Scene moved forward." },
      { event_type: "encounter_resolved", description: "Enemies defeated." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("Scene moved forward.");
    expect(r.lines).toContain("Enemies defeated.");
  });

  it("events without description are excluded even if NOTABLE kind", () => {
    const events: SessionEvent[] = [
      { event_type: "scene_advance" },
      { event_type: "encounter_resolved", description: "The skeletons crumbled." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toHaveLength(1);
    expect(r.lines).toContain("The skeletons crumbled.");
  });

  it("legacy combat and combat_end aliases still surface for backward compat", () => {
    const events: SessionEvent[] = [
      { event_type: "combat", description: "Battle with the troll erupted." },
      { event_type: "combat_end", description: "The troll was slain." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toContain("Battle with the troll erupted.");
    expect(r.lines).toContain("The troll was slain.");
  });

  it("opening_narrated events are not surfaced in the recap (no description)", () => {
    const events: SessionEvent[] = [
      { event_type: "opening_narrated" },
      { event_type: "scene_advance", description: "Into the tunnel." },
    ];
    const r = buildRecap(base, events);
    expect(r.lines).toHaveLength(1);
    expect(r.lines).toContain("Into the tunnel.");
  });
});
