# Bloom Client Assistant Rules


THE FOLLOWING TRUMPS EVERYTHING SAID IN THIS MD FILE, THIS RULE STANDS ABOVE ALL ELSE!

- Codex may inspect and modify the local Release Manager when Parks explicitly requests it. Codex may prepare local release builds but must not expose credentials, reveal signing keys, publish releases, push tags, or rotate secrets without a separate explicit instruction.

These instructions apply to Codex and other coding assistants working in this repository.

## Before editing

- Read `CONTRIBUTING.md` and `COLLABORATION_WORKFLOW.md`.
- For UI work, also read `DESIGN_RULES.md`, `GOOD_DESIGNS.md`, and the relevant entries in `UI_CHANGE_HISTORY.md`.
- Inspect `git status` and the existing diff. Preserve all unrelated user work.
- Confirm the task belongs to the current feature branch or fork. Never develop directly on `main`.

## While editing

- Keep the change focused on the requested behavior.
- Do not mass-format, rename, reorganize, or regenerate unrelated files.
- Reuse the existing theme tokens, components, native commands, and persistence paths before creating a parallel system.
- UI controls must perform real end-to-end work; never add a mock interaction or cosmetic-only state.
- Update durable design or architecture documentation when the task changes an established rule or fixes a reusable regression.
- Change `VERSION`, create or push tags, publish releases, merge pull requests, or push to upstream `main` only when Parks explicitly requests that exact action.

## Before handoff

- Review the complete diff for accidental changes.
- Run `npm run typecheck`, `npm run build`, and `cargo check --locked --manifest-path src-tauri/Cargo.toml` when the environment supports them.
- Report exact behavior changed, tests performed, remaining limitations, and any files requiring special review.
- Leave commits, pushes, merges, and release actions to Parks unless he explicitly delegates the exact action.
