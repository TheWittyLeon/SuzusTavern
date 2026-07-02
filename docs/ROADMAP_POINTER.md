# Roadmap pointer

The canonical Tavern + Multi-System roadmap (Sprints 1–10, 53 stories with AC + test plans)
lives in the Obsidian vault — not in this repo — per the workspace's "vault = canonical docs"
convention:

- **Overview / sprint map / decisions:** `MainVault/planning/Tavern-MultiSystem-Roadmap/_Roadmap Overview.md`
- **Per-sprint stories:** the `Sprint NN-NN — *.md` files in that folder.
- **Design docs it implements:**
  - `MainVault/architecture/RulesSystem Interface + DM-Mode Design.md` (the engine `RulesSystem`
    abstraction + the 3-axis DM/AI session model + the AI-off interlock)
  - `MainVault/architecture/Multi-System TTRPG Content Model.md` (the DB content model)

Headline arc: **5e solid (S1–3) → human-DM with AI fully optional/off (S4–5) →
Fallout 2d20 with full mechanical crunch from owned rulebooks via a review-gated ingest (S6–9) →
hardening + legacy retire (S10).**
