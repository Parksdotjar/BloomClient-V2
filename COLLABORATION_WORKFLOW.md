# Bloom Client Collaboration Workflow

This workflow lets Parks and Karsten build in parallel without sharing a working directory, overwriting unfinished work, or giving contributor code a path to production releases.

## Release boundary

Parks remains the repository owner and final release authority. Parks may perform owner actions personally or explicitly delegate a specific action to Codex, including modifying the local Release Manager, committing approved work, merging into `main`, changing the release version, creating or pushing a tag, building release artifacts, and publishing a release.

Delegation must be explicit and limited to the requested action. Permission to inspect or modify the Release Manager does not automatically authorize publishing. Permission to prepare a release build does not automatically authorize pushing a tag or creating a public release.

Codex may use the existing authenticated GitHub and signing configuration through its intended local tools, but must never print, expose, copy, commit, replace, or weaken credentials, signing keys, passwords, tokens, private catalogs, or `.env` contents. Secret rotation requires a separate explicit instruction from Parks.

Before any merge or release, verify the complete diff, required frontend and Rust checks, the selected version, the target branch, repository synchronization, and the intended release destination. Report unresolved failures or production risks before publishing.


## Parks's normal loop

Parks continues working in the primary Bloom folder. Karsten's PR is tested in a separate sibling folder, so checking it out cannot replace local files or interrupt unfinished work.

From the primary repository:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/review-pr.ps1 -PullRequest 123 -Launch
```

This fetches PR 123, creates or refreshes `BloomClient-PR-Reviews/PR-123` beside the primary repository, installs dependencies when needed, and opens Tauri development from that isolated worktree. The primary branch and dirty files remain untouched.

After testing, leave an approval or requested changes on GitHub. New commits invalidate the earlier approval and should be tested again. Once checks, review, and hands-on testing all pass, use GitHub's **Squash and merge**, then delete the feature branch.

Remove a finished review worktree only when it is clean:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/review-pr.ps1 -PullRequest 123 -Remove
```

## Avoiding conflicts before they happen

- Agree on ownership of a task before editing. Do not independently solve the same issue.
- Avoid simultaneous broad edits to `src/main.tsx` and `src/styles.css`. Prefer extracting a focused component or stylesheet when work would otherwise overlap.
- Keep PRs small enough to review in one sitting. Separate refactors from behavior changes.
- Land shared foundations first, then rebase dependent work.
- Never resolve a conflict by choosing an entire file blindly. Preserve both intended changes and rerun the complete checks.
- Backend or storage changes must remain backward-compatible with the currently released client unless the PR includes an explicit migration and rollback plan.

## What `main` means

`main` is reviewed, checked, and eligible for release—not an active scratch branch. Required GitHub checks are `frontend` and `rust`; conversation resolution and an owner approval are required for contributor pull requests. Force pushes and branch deletion are disabled.

Parks retains the administrator bypass because the private Manager creates the release-version commit directly on synchronized `main`. That bypass is for the Manager's release transaction, not ordinary development.

### Release checks

Merging a pull request never creates an update. The release workflow accepts tags only from `Parksdotjar`, requires the tag to point at the current upstream `main`, and requires `VERSION` to match the tag. The private Manager additionally refuses to run under another GitHub CLI account, on another branch, with uncommitted files, or while local and remote `main` differ.

The Manager's source, binaries, credentials, and signing keys are not part of this repository. Karsten does not need them to develop or submit pull requests.

## AI-assistant checklist

Both developers should give their coding assistant these constraints at the start of a task:

- Read the repository guidance and relevant design/architecture files before editing.
- Inspect the current diff and preserve unrelated work.
- Change only the requested scope; do not mass-format or silently redesign neighboring features.
- Use existing components and tokens before adding a parallel system.
- Keep real functionality wired end to end; do not add mock buttons or cosmetic state.
- Run the repository checks and summarize exact files and behavior changed.
- Never commit, merge, tag, release, alter secrets, or modify owner-only tooling unless Parks explicitly requests that exact action.
