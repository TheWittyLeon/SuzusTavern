#!/usr/bin/env python3
"""generate-tactical-map-parity-fixture.py — Kage-CR B8c-3a 🟢 1, ledger item 19.

Generates `src/__tests__/fixtures/tactical_map_parity.json`: a DETERMINISTIC,
table-driven cross of the axes Kage-CR's ad hoc reviewer script exercised
(2026-09-29 review, never committed anywhere) — 17 `cell.value`s x 8 `cell`
containers x 9 `kind`s x 14 paired `width`/`height` values, each case's
EXPECTED verdict recorded from the REAL engine `move_legality`
(`engine/combat.py`, engine `main` @ 8eaf152), not a hand-transcription of
its documented behaviour. `src/components/tactical-map/reach.ts`'s
`isLegalMoveTarget`/`reachableCells` are asserted to agree with this
recorded verdict for every case
(`src/__tests__/components/tactical-map/tactical-map-parity.test.ts`).

WIDTH/HEIGHT ARE PAIRED (width == height == the same DIMS value), not
independently crossed (which would be 11x11=121 dims combos, not 11) — this
keeps the matrix small and deterministic, while still exercising every
malformed dims value from Kage's own DIMS axis at least once against every
(kind, cell) combination. Kage's own 4,000-case run varied width and height
independently, but RANDOMLY, not exhaustively — this script trades that
independence for determinism and a stable, reviewable case count.

DIMS also carries `0.5` and `NaN` (Kage-CR B8c-3b IMPORTANT-4 / Miko-QA,
ledger item 22, 2026-09-29 — the reach.ts-side `isDimsValid` fix's own two
missing shapes from the earlier `-3`/`0`/`"5"`/`5.5` set). `5.0` is
DELIBERATELY not a DIMS value here, unlike those: it is unrepresentable as
a value distinct from `5` once it round-trips through JSON into JS
(`JSON.parse("5.0") === 5`), so a fixture case for it would encode a
divergence this parity test cannot ever close on the client side — see
`isDimsValid`'s own docstring in reach.ts.

The BLOCKED/OCCUPIED/BUDGET axes below (Kage-CR B8c-3b IMPORTANT-2, ledger
item 24) are a SEPARATE, small, fully-crossed block
(`build_destination_budget_cases`) on a single FIXED valid board, not a
fourth loop level over the whole kind x dims x cell matrix: most of that
matrix already refuses at `no_space`/`mover_unplaced` (an unregistered
kind, a malformed cell, or dims too small for `frm`) before `move_legality`
ever reaches its blocked/occupied/budget steps (5/6/8), so crossing those
axes against every row above would mostly just duplicate the SAME reason
under a different label — real coverage of the destination/budget seam
needs a board where those steps are actually reached.

HOW TO REGENERATE (only when `move_legality`'s CONTRACT changes — a new
step, a new refusal reason, a changed evaluation order — not for routine
engine work elsewhere):

    cd NekoNova-DnDEngine
    git worktree add --detach /tmp/engine-parity-src <pinned-commit>
    cd SuzusTavern
    python3 scripts/generate-tactical-map-parity-fixture.py \
        --engine-path /tmp/engine-parity-src \
        --engine-commit <pinned-commit>
    git -C NekoNova-DnDEngine worktree remove /tmp/engine-parity-src

`git worktree add` (unlike `git archive | tar -x`) produces a real linked
checkout with its own `.git` FILE pointing back at the main repo, so the
script's own `verify_engine_commit` can actually run `git rev-parse HEAD`
inside it and refuse a stale or wrong checkout before minting bogus
verdicts (Kage-CR B8c-3b IMPORTANT-3, ledger item 24, 2026-09-29: the
previously-documented `git archive` path produces a tree with NO `.git`,
so the check silently no-ops there — measured, an `--engine-commit
deadbeef…` typo on an archive tree wrote a full fixture with that literal
lie recorded as `engine_commit`). `move_legality` imports and runs
standalone with no DB — never a live `suzu_dnd`/`suzu_dnd_dev` connection.

Update the sha256, case-count AND reason-histogram literals in
`tactical-map-parity.test.ts` after regenerating (the test's own header
explains why — same "digest-pinned fixture, edit both or the guard is
inert" mechanism as `reach_vectors.json`/`reach-vectors.test.ts`; the
histogram is item 24's own addition — see that file's header for why a sha
pin alone does not catch a degenerate regeneration).

FOLLOW-UP, ROUTED, NOT DONE HERE: a digest-pinned COPY of this fixture (or
its generator) in the engine repo, matching `tests/fixtures/
reach_vectors.json`'s two-repo pin, so an engine-side `move_legality`
change is forced to re-run this script in the SAME PR that changes it,
rather than relying on a human remembering to. Coordinator to route
(Kage-CR B8c-3a review, 2026-09-29).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import subprocess
import sys

ABSENT = object()  # sentinel: "this key is not present at all" -- never serialized


def sent(v):
    """Python value -> JSON-safe sentinel form (NaN/Infinity have no JSON token)."""
    if isinstance(v, float):
        if math.isnan(v):
            return {"__SENT__": "nan"}
        if v == math.inf:
            return {"__SENT__": "inf"}
        if v == -math.inf:
            return {"__SENT__": "-inf"}
    return v


def encode(o):
    if isinstance(o, dict):
        return {k: encode(v) for k, v in o.items()}
    if isinstance(o, list):
        return [encode(v) for v in o]
    return sent(o)


# ── Kage-CR B8c-3a axis value sets, reused verbatim from the review's own
# scratch generator (not re-invented) ──────────────────────────────────────
CELL_VALUES = [
    2.5,
    5,
    10,
    1,
    0.5,
    "5",
    None,
    True,
    False,
    [5],
    {},
    0,
    -5,
    math.nan,
    math.inf,
    -math.inf,
    ABSENT,
]  # 17
CELL_SHAPES = ["dict", None, ABSENT, [5], "5", 5, True, {}]  # 8
KINDS = ["square", "hex", "zones", None, ABSENT, "", "Square", 0, True]  # 9
# 14, paired width == height. `0.5` and `math.nan` added by Kage-CR B8c-3b
# IMPORTANT-4 / Miko-QA (ledger item 22, 2026-09-29) -- the two malformed
# dims shapes reach.ts's `isDimsValid` fix closes that the original 9-value
# axis never exercised (`5.0` deliberately excluded -- see the module
# docstring above). `100`/`101`/`1e21` added by B8c-3d (ledger row 26,
# 2026-09-29) for `engine/space.py::SPACE_MAX_DIM = 100` (engine `main` @
# `8eaf152`, B8e): `100` is the ceiling itself (must stay legal -- the
# engine's OWN boundary test asserts this, `test_..._at_the_max_dim_
# ceiling_is_legal`), `101` is one past it (refused on MAGNITUDE, via
# `_dim_in_range`'s `dim <= SPACE_MAX_DIM` clause -- the case that actually
# exercises the new bound). `1e21` is refused too, but for a DIFFERENT
# reason than the client mirror's own `1e21` render-hang case (reach.ts's
# `isDimsValid`/`TacticalMap.dimsUpperBound.test.tsx`): a Python JSON float
# literal is never `isinstance(dim, int)`, so it fails `_dim_in_range`'s
# TYPE clause before the magnitude clause is ever reached -- same class as
# the pre-existing `5.5`/`0.5` rows, not a new mechanism. It is included
# here for wire-shape coverage (a `1e21`-valued JSON number round-trips
# fine through both `json.dumps`/`JSON.parse`), not because it proves the
# magnitude bound -- `101` is what proves that.
DIMS = [5, 8, 1, "5", 5.5, 0.5, -3, None, ABSENT, 0, math.nan, 100, 101, 1e21]  # 14

FROM = [2, 2]
TO = [2, 3]
BUDGET = 30

# ── Kage-CR B8c-3b IMPORTANT-2, ledger item 24 (2026-09-29): blocked,
# occupied and budget were each single-valued (`[]` / `{}` / `30`) across
# the entire matrix above, so the fixture had ZERO `invalid_destination`
# and ZERO `no_movement_remaining` coverage. See `build_destination_budget_
# cases` below for why these are a separate small block, not a fourth loop
# level over the whole kind x dims x cell matrix. ────────────────────────
BLOCKED_VARIANTS = [[], [TO]]  # 2: TO open, TO blocked
OCCUPIED_VARIANTS: "list[dict]" = [
    {},
    {"blocker": TO},
]  # 2: TO free, TO occupied (by another participant)
BUDGET_VARIANTS = [30, 0]  # 2: sufficient, exhausted


def build_space(kind, cell_shape, cell_value, dims, blocked=None) -> dict:
    sp: dict = {}
    if kind is not ABSENT:
        sp["kind"] = kind
    if dims is not ABSENT:
        sp["width"] = dims
        sp["height"] = dims
    sp["blocked"] = [] if blocked is None else blocked
    sp["features"] = []
    if cell_shape == "dict":
        cell: dict = {"unit": "ft"}
        if cell_value is not ABSENT:
            cell["value"] = cell_value
        sp["cell"] = cell
    elif cell_shape is not ABSENT:
        sp["cell"] = cell_shape
    return sp


def describe(kind, cell_shape, cell_value, dims) -> str:
    cv = (
        "n/a"
        if cell_shape != "dict"
        else ("absent" if cell_value is ABSENT else repr(cell_value))
    )
    return (
        f"kind={'absent' if kind is ABSENT else kind!r} "
        f"cell={'absent' if cell_shape is ABSENT else cell_shape!r} "
        f"cell.value={cv} dims={'absent' if dims is ABSENT else dims!r}"
    )


def build_cases() -> list[dict]:
    cases = []
    for kind in KINDS:
        for dims in DIMS:
            for cell_shape in CELL_SHAPES:
                values = CELL_VALUES if cell_shape == "dict" else [ABSENT]
                for cell_value in values:
                    cases.append(
                        dict(
                            desc=describe(kind, cell_shape, cell_value, dims),
                            space=build_space(kind, cell_shape, cell_value, dims),
                            frm=FROM,
                            to=TO,
                            budget=BUDGET,
                            others={},
                        )
                    )
    cases.extend(build_destination_budget_cases())
    return cases


def build_destination_budget_cases() -> list[dict]:
    """Kage-CR B8c-3b IMPORTANT-2, ledger item 24: a small, fully-crossed
    block on a single FIXED valid board (`kind='square'`, dims=5,
    `cell.value=5`) so `move_legality` steps 5/6 (`invalid_destination`, via
    `blocked`/`occupied`) and step 8 (`no_movement_remaining`, via
    `budget`) are actually reached, not swallowed by an earlier `no_space`/
    `mover_unplaced` refusal the way crossing these axes against the whole
    kind x dims x cell matrix above would mostly be (see the module
    docstring for why this is a separate block, not a fourth loop level).
    """
    cases = []
    for blocked in BLOCKED_VARIANTS:
        for occupied in OCCUPIED_VARIANTS:
            for budget in BUDGET_VARIANTS:
                cases.append(
                    dict(
                        desc=(
                            "kind='square' dims=5 cell.value=5 "
                            f"blocked={blocked!r} occupied={list(occupied.values())!r} "
                            f"budget={budget!r}"
                        ),
                        space=build_space("square", "dict", 5, 5, blocked=blocked),
                        frm=FROM,
                        to=TO,
                        budget=budget,
                        others=occupied,
                    )
                )
    return cases


def verify_engine_commit(
    engine_path: pathlib.Path, expected_commit: str | None
) -> None:
    git_dir = engine_path / ".git"
    if not git_dir.exists():
        print(
            f"NOTE: {engine_path} has no .git (a git-archive extraction) — cannot verify "
            f"the commit from inside the script; verify the archive command used the right ref.",
            file=sys.stderr,
        )
        return
    if expected_commit is None:
        return
    actual = subprocess.run(
        ["git", "-C", str(engine_path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if not actual.startswith(expected_commit) and not expected_commit.startswith(
        actual
    ):
        raise SystemExit(
            f"engine checkout at {engine_path} is {actual}, expected {expected_commit} "
            f"-- refusing to generate a fixture from the wrong engine commit."
        )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--engine-path", required=True, help="path to a NekoNova-DnDEngine checkout"
    )
    ap.add_argument(
        "--engine-commit",
        default=None,
        help="expected commit hash (verified if the checkout has .git)",
    )
    ap.add_argument(
        "--out",
        default=None,
        help="output fixture path (default: src/__tests__/fixtures/tactical_map_parity.json next to this script's repo root)",
    )
    a = ap.parse_args()

    engine_path = pathlib.Path(a.engine_path).expanduser().resolve()
    verify_engine_commit(engine_path, a.engine_commit)

    sys.path.insert(0, str(engine_path))
    from engine.combat import move_legality  # noqa: E402  (path must be set first)

    cases = build_cases()
    out_cases = []
    n_err = 0
    for c in cases:
        try:
            ok, reason, cost = move_legality(
                c["space"], c["frm"], c["to"], c["budget"], c["others"]
            )
            legal, err = bool(ok), None
        except Exception as e:  # noqa: BLE001 -- recording the failure IS the point
            legal, reason, cost, err = None, None, None, f"{type(e).__name__}: {e}"
            n_err += 1
        out_cases.append(
            dict(
                desc=c["desc"],
                space=encode(c["space"]),
                frm=c["frm"],
                to=c["to"],
                budget=c["budget"],
                # `others` maps participant_id -> at (move_legality's own
                # shape); the client's `occupied` param is just the `at`
                # values (SpaceCoordinate[]) -- same conversion `others` ->
                # `occupied` every other caller of this predicate makes.
                occupied=list(c["others"].values()),
                legal=legal,
                reason=reason,
                err=err,
            )
        )

    fixture = {
        "_mechanism": (
            "Kage-CR B8c-3a parity generator (ledger item 19). Every case's `legal`/`reason`/`err` "
            "is the REAL engine.combat.move_legality's verdict at the commit named below, not a "
            "hand-transcription. src/components/tactical-map/reach.ts's isLegalMoveTarget/"
            "reachableCells are asserted (tactical-map-parity.test.ts) to agree with `legal` for "
            "every case where `err` is null; where `err` is non-null (the engine itself raised on "
            "a malformed width/height combination Python's own bounds comparison chokes on), the "
            "test asserts only that the client never throws -- see that file's header for the "
            "measured count. Digest-pinned: any edit to this fixture must update BOTH the sha256 "
            "and case-count literals in tactical-map-parity.test.ts, same mechanism as "
            "reach_vectors.json/reach-vectors.test.ts."
        ),
        "engine_commit": a.engine_commit,
        "cases": out_cases,
    }

    repo_root = pathlib.Path(__file__).resolve().parent.parent
    out_path = (
        pathlib.Path(a.out)
        if a.out
        else repo_root / "src" / "__tests__" / "fixtures" / "tactical_map_parity.json"
    )
    raw = json.dumps(fixture, indent=2, sort_keys=False)
    out_path.write_text(raw + "\n")

    digest = hashlib.sha256((raw + "\n").encode()).hexdigest()

    # Kage-CR B8c-3b IMPORTANT-2, ledger item 24: printed BEFORE the
    # summary below so a degenerate regeneration (e.g. every case
    # collapsing to `no_space`) is loud to a human watching this run, not
    # only caught later by tactical-map-parity.test.ts's own histogram
    # assertion (the actual gate -- this print is a second, earlier signal,
    # not a replacement for it).
    histogram: dict[str, int] = {}
    for c in out_cases:
        if c["err"] is not None:
            continue
        key = c["reason"] or ""
        histogram[key] = histogram.get(key, 0) + 1
    print(f"reason histogram: {histogram}")

    print(f"wrote {len(out_cases)} cases to {out_path}")
    print(f"engine raised on {n_err} case(s)")
    print(f"sha256: {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
