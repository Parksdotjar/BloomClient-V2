# Bloom Client Collaboration Workflow

This workflow lets Parks and Karsten build in parallel without sharing a working directory, overwriting unfinished work, or giving contributor code a path to production releases.

## Roles and trust boundary

### Parks — owner and release authority

- Owns the upstream repository, product decisions, final review, merge, and releases.
- Tests pull requests in isolated Git worktrees before approval.
- Is the only code owner and the only GitHub identity accepted by the release workflow and local Release Manager.
- Uses the private Manager only after approved work has reached a clean, synchronized `main`.

### Karsten — contributor

- Forks `Parksdotjar/BloomClient-V2` into his own GitHub account.
- Develops on focused branches in that fork and opens pull requests into upstream `main`.
- Can update his pull requests freely without touching Parks's branches, local files, tags, or release credentials.
- Never bumps the release version, pushes a Bloom tag, publishes a release, or adds private tooling.

Fork-based contribution is intentional. Repository write access would let a contributor push branches or tags that can interact with GitHub Actions. A fork provides the same PR collaboration while keeping updater signing and production authority owner-only.

## Karsten's normal loop

1. Fork the repository on GitHub and clone his fork.
2. Add the Bloom repository as `upstream`:

   ```powershell
   git remote add upstream https://github.com/Parksdotjar/BloomClient-V2.git
   ```

3. Start every task from current upstream `main`:

   ```powershell
   git fetch upstream
   git switch -c karsten/short-task-name upstream/main
   ```

4. Commit only the focused change and push it to his fork:

   ```powershell
   git push -u origin karsten/short-task-name
   ```

5. Open a draft pull request into `Parksdotjar/BloomClient-V2:main`, complete the template, and mark it ready only after local checks pass.
6. If `main` changes while the PR is open, update without mixing unrelated work:

   ```powershell
   git fetch upstream
   git rebase upstream/main
   git push --force-with-lease
   ```

`--force-with-lease` is acceptable only on the contributor's own feature branch—never on `main`.

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

## Release boundary

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
