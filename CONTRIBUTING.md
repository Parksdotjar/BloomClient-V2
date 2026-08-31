# Contributing to Bloom Client

Bloom uses a fork, pull-request, review, and owner-release workflow. Read [`COLLABORATION_WORKFLOW.md`](COLLABORATION_WORKFLOW.md) before starting work.

## Non-negotiable rules

- Never develop directly on `main`.
- External contributors, including regular collaborators, work from a fork and open a pull request into `Parksdotjar/BloomClient-V2:main`.
- Keep one feature or fix per branch and pull request.
- Do not change `VERSION`, create release tags, publish releases, or modify updater signing behavior. Releases are owner-only.
- Never commit credentials, tokens, signing keys, `.env` files, private catalogs, or owner-only tooling.
- Do not overwrite unrelated edits, mass-format the repository, or regenerate lockfiles without a related dependency change.
- UI work must follow `DESIGN_RULES.md`, `GOOD_DESIGNS.md`, and `UI_CHANGE_HISTORY.md`. Update the relevant documentation when a design decision or reusable fix changes.

## Branches and commits

Create branches from the latest `main` using a short owner/topic name:

```text
karsten/mod-search-cache
karsten/fix-instance-delete
parks/custom-accent-picker
```

Use clear commits such as `feat:`, `fix:`, `docs:`, `refactor:`, or `test:`. Do not mix cleanup with feature work. Pull requests are squash-merged, so the PR title must describe the final change clearly.

## Before requesting review

Run:

```powershell
npm ci
npm run typecheck
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

Then provide:

- A concise explanation of what changed and why.
- Exact testing steps and results.
- Before/after screenshots or a short recording for visible UI changes.
- Any known risk, platform limitation, migration, or follow-up.
- Confirmation that the branch contains no version bump, release tag, secret, private tool, or unrelated file change.

## Review and merge

Automated `frontend` and `rust` checks must pass. Parks is the code owner and performs the final review and hands-on test. Address feedback on the same branch; new commits dismiss the prior approval. Only Parks merges to `main`, using squash merge.

Passing review means the change is safe to join `main`; it does not publish a Bloom Client update. Releases remain a separate owner-only action performed after `main` is clean, synchronized, and tested.
