#!/usr/bin/env python3
"""generate-tactical-map-parity-fixture.py — Kage-CR B8c-3a 🟢 1, ledger item 19.

Generates `src/__tests__/fixtures/tactical_map_parity.json`: a DETERMINISTIC,
table-driven cross of the axes Kage-CR's ad hoc reviewer script exercised
(2026-09-29 review, never committed anywhere) — 17 `cell.value`s x 8 `cell`
containers x 9 `kind`s x 9 paired `width`/`height` values, each case's
EXPECTED verdict recorded from the REAL engine `move_legality`
(`engine/combat.py`, engine `main` @ 3a5d18b), not a hand-transcription of
its documented behaviour. `src/components/tactical-map/reach.ts`'s
`isLegalMoveTarget`/`reachableCells` are asserted to agree with this
recorded verdict for every case
(`src/__tests__/components/tactical-map/tactical-map-parity.test.ts`).

WIDTH/HEIGHT ARE PAIRED (width == height == the same DIMS value), not
independently crossed (which would be 9x9=81 dims combos, not 9) — this
keeps the matrix at 1,944 deterministic cases instead of ~17,500, while
still exercising every malformed dims value from Kage's own DIMS axis at
least once against every (kind, cell) combination. Kage's own 4,000-case
run varied width and height independently, but RANDOMLY, not exhaustively
— this script trades that independence for determinism and a stable,
reviewable case count.

HOW TO REGENERATE (only when `move_legality`'s CONTRACT changes — a new
step, a new refusal reason, a changed evaluation order — not for routine
engine work elsewhere):

    cd NekoNova-DnDEngine
    git archive <pinned-commit> | tar -x -C /tmp/engine-parity-src
    cd SuzusTavern
    python3 scripts/generate-tactical-map-parity-fixture.py \
        --engine-path /tmp/engine-parity-src \
        --engine-commit <pinned-commit>

The script verifies the archive's `git rev-parse HEAD` (when it has a
`.git`) matches `--engine-commit` before running anything, so a stale or
wrong checkout cannot silently mint bogus verdicts. `move_legality` imports
and runs standalone with no DB — never a live `suzu_dnd`/`suzu_dnd_dev`
connection.

Update BOTH the sha256 and case-count literals in
`tactical-map-parity.test.ts` after regenerating (the test's own header
explains why — same "digest-pinned fixture, edit both or the guard is
inert" mechanism as `reach_vectors.json`/`reach-vectors.test.ts`).

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
DIMS = [5, 8, 1, "5", 5.5, -3, None, ABSENT, 0]  # 9, paired width == height

FROM = [2, 2]
TO = [2, 3]
BUDGET = 30
OTHERS: dict = {}


def build_space(kind, cell_shape, cell_value, dims) -> dict:
    sp: dict = {}
    if kind is not ABSENT:
        sp["kind"] = kind
    if dims is not ABSENT:
        sp["width"] = dims
        sp["height"] = dims
    sp["blocked"] = []
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
                            occupied=[],
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
                c["space"], c["frm"], c["to"], c["budget"], OTHERS
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
                occupied=c["occupied"],
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
    print(f"wrote {len(out_cases)} cases to {out_path}")
    print(f"engine raised on {n_err} case(s)")
    print(f"sha256: {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
