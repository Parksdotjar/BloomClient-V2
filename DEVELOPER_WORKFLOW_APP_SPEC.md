# Bloom Developer Workflow Apps

## Decision

Keep the existing fork, branch, pull-request, isolated-review, and owner-only release workflow. Simplify it with two role-specific desktop interfaces:

1. **Bloom Workshop** — one safe contributor application used by Karsten and future developers.
2. **Bloom Manager: Reviews** — a private owner-only section added to Parks's existing Release Manager.

Do not distribute one combined application. A shared application containing owner release behavior would weaken the boundary that protects `main`, updater signing, tags, and releases. The contributor application does not contain, unlock, or imitate release functionality.

Developers do not each need a custom build. Bloom Workshop is the same installer for every contributor; each person completes a one-time local profile containing their name, GitHub username, preferred branch prefix, and repository folder.

## What this simplifies

The applications hide routine Git commands while keeping GitHub as the source of truth. They do not replace forks or pull requests.

### Karsten's experience

Karsten sees one workspace screen with these actions:

- **Sync Bloom** — fetches upstream `main` and reports whether his fork is current.
- **Start change** — asks for a short task name, then creates a correctly named branch from current upstream `main`.
- **Open in editor** — opens the correct branch folder in his editor or coding assistant.
- **Run Bloom** — starts the Tauri development client for that branch.
- **Review changes** — shows changed files, additions/removals, and warnings for protected files.
- **Check change** — runs type checking, the frontend build, and the supported Rust check with plain-language results.
- **Send to Parks** — commits the selected files, pushes the contributor branch, and opens or updates one draft pull request.
- **View feedback** — shows GitHub review comments and whether a newer revision is required.
- **Send revision** — reruns checks and updates the same pull request.
- **Finish task** — offered only after merge or closure; removes the clean local task workspace and branch.

The primary status should always be written in plain language, for example:

- `Ready to start a change`
- `3 files changed — not sent yet`
- `Checks passed — ready for Parks`
- `Waiting for Parks to review`
- `Parks requested changes`
- `Approved — waiting for Parks to merge`
- `Merged into main`

Karsten should never need to type a branch name, remote name, PR number, or Git command during the normal path.

### Parks's experience

The private Manager gains a **Reviews** section that lists open Bloom pull requests as cards. Each card shows:

- Developer and task name.
- Draft or ready status.
- Files changed and protected-file warnings.
- Frontend and Rust check results.
- Review state and whether new commits arrived after the last test.
- The exact branch and commit being reviewed.

Each card has focused actions:

- **Test separately** — creates or refreshes the isolated `BloomClient-PR-Reviews/PR-N` worktree and launches that copy of Bloom Client.
- **View changes** — opens the GitHub diff or a local read-only diff view.
- **Request changes** — records feedback on the existing PR.
- **Approve** — available only after required checks pass and the tested commit still matches the PR head.
- **Squash and merge** — owner-only, with a final summary and confirmation.
- **Clean review copy** — removes the stopped, clean isolated worktree.

Testing a PR must never switch Parks's primary folder, stash its files, close it, or write into it. If port `1420` is occupied, the Manager explains the conflict and asks Parks to stop the currently running development process; it never kills it automatically.

After a merge, the Reviews section may offer **Sync main**, but it does not create an update. The existing **Make update** flow remains a separate owner action and stays locked until local `main` is clean, synchronized, and eligible for release.

## One-time contributor setup

Bloom Workshop asks for:

- Display name.
- GitHub username.
- Branch prefix, defaulting to a normalized form such as `karsten/`.
- Local development folder.
- Preferred editor or coding-assistant command.

It then performs visible checks:

- Git is installed.
- GitHub CLI is installed and authenticated as the entered GitHub user.
- Node.js/npm, Rust, and Bloom's Tauri prerequisites are available.
- `origin` points to the contributor's fork.
- `upstream` points to `Parksdotjar/BloomClient-V2`.
- The contributor can read upstream and push only to their fork.

If the repository has not been cloned, the app can guide the user through forking on GitHub and clone the fork into a chosen empty folder. It must show the resolved account, fork, upstream repository, branch, and folder before making changes.

## Task flow

### Concrete example: Karsten builds a theme editor

Karsten opens Bloom Workshop and creates a task named `Theme editor`. Workshop creates a dedicated folder and branch for only that task, for example:

```text
C:\Users\Karsten\Documents\Bloom-Workshop\theme-editor
karsten/theme-editor
```

That folder is a real Git worktree containing a complete, runnable Bloom Client checkout. Karsten can open that exact folder in ChatGPT, Codex, another coding assistant, or a normal editor. The assistant sees and edits only the theme-editor task checkout; Karsten's other tasks and base clone remain separate.

Karsten can change any Bloom product code needed for the feature, run the Tauri development client from the task folder, test the theme editor end to end, and keep revising it until he is satisfied. Workshop still protects release-only files, credentials, tags, upstream `main`, and owner tooling.

When Karsten clicks **Send to Parks**, Workshop reviews the changed files, runs the required checks, commits the approved task changes, pushes `karsten/theme-editor` to Karsten's fork, and opens or updates its pull request.

Parks's private Manager then creates a separate owner-side review folder for the exact pull-request commit, for example:

```text
C:\Users\Parks\Documents\BloomClient-PR-Reviews\PR-24
```

Parks clicks **Test separately** and receives a Tauri development client built from Karsten's submitted version. Parks's normal Bloom workspace and unfinished work remain unchanged. Parks can request revisions, and every new revision makes the previous test result stale until Parks refreshes and tests the new commit.

If Parks accepts the feature, Parks approves and squash-merges the PR into upstream `main`. That makes the theme editor reviewed Bloom Client code, but it still does not reach users. Parks can combine it with other accepted work, test synchronized `main`, and then use the private Release Manager to choose the next version and create the real signed Bloom Client update. Until Parks completes that separate release action, no contributor submission is delivered through the updater.

### 1. Start

The contributor enters a task name such as `Fix mod search loading`. Bloom Workshop:

1. Verifies there are no unfinished changes in the selected base workspace.
2. Fetches current upstream `main`.
3. Creates an isolated local task worktree rather than reusing another active task folder.
4. Creates a branch such as `karsten/fix-mod-search-loading`.
5. Creates an early draft PR after the first commit so Parks can see who owns the area.

Using one worktree per task means Karsten can pause one task and work on another without switching or mixing files.

### 2. Develop

The task page shows the current branch, local folder, changed files, and whether the local development client is running. It can open the project in an editor or coding assistant and can copy a task prompt containing the repository rules from `AGENTS.md`.

The app never edits product code itself. It coordinates the workspace around changes made by the developer or their assistant.

### 3. Check and send

Before enabling **Send to Parks**, Bloom Workshop:

1. Shows the complete changed-file list.
2. Blocks protected release files and owner-only paths.
3. Warns about unrelated or unusually broad changes.
4. Runs the required checks.
5. Asks for a concise summary and testing notes.
6. Creates a clear commit, pushes only to the contributor fork, and creates or updates the draft PR.

The generated PR description includes the summary, exact tests, screenshots selected by the developer, risks, and known limitations.

### 4. Review and revision

Parks tests the exact PR commit from Bloom Manager. If Parks requests changes, Bloom Workshop shows the feedback on the existing task. Karsten edits the same task worktree and clicks **Send revision**. The same PR updates; a duplicate PR is never created.

Bloom Manager marks its prior hands-on result stale when the PR head commit changes. Parks must refresh and retest before approval.

### 5. Merge and release

Only Parks can approve and squash-merge into upstream `main`. Only Parks's private Manager can later create a version commit, tag, signed build, and GitHub release. Contributor actions end at a reviewed pull request.

## Authentication and stored data

- Use the installed GitHub CLI for GitHub authentication and operations.
- If GitHub authentication is missing, launch the official browser/device login flow.
- Do not ask contributors to paste personal access tokens into Bloom Workshop.
- Do not read, copy, display, or store GitHub tokens in application settings.
- Store only non-secret preferences locally, such as username, folder, editor, and branch prefix.
- Prefer the operating system credential manager for any future credential requirement.
- Never include updater signing keys, release credentials, private catalogs, or owner-only Manager code in Bloom Workshop.

## Mandatory development-data isolation

A separate source worktree is not enough by itself. Bloom currently stores backend data below `%APPDATA%\BloomClient`, and its webview also has persistent local state. A development or PR-review build must never silently reuse the installed client's live profile.

Every Workshop task and Manager review must launch with a unique runtime-data sandbox, for example:

```text
%LOCALAPPDATA%\BloomWorkshop\tasks\theme-editor\profile
%LOCALAPPDATA%\BloomManager\reviews\PR-24\profile
```

The Bloom backend supports the explicit debug-only `BLOOM_DEV_DATA_DIR` data-root override. Release builds ignore that override. Workshop also launches WebView2 with a unique `WEBVIEW2_USER_DATA_FOLDER`, so localStorage, account UI state, settings, and caches cannot cross between the installed client and a development task.

Default task profiles begin empty. The developer may explicitly copy a test instance or test settings into the sandbox, but Workshop must copy the data rather than link to the real folder. It must not automatically copy Microsoft tokens, account credentials, personal worlds, launcher instances, custom backgrounds, or downloads.

Useful profile actions are:

- **Open test data** — opens only the task's sandbox.
- **Import test instance** — copies a selected instance into the sandbox with a size preview.
- **Reset test profile** — removes only the selected stopped task's generated sandbox after confirmation.
- **Keep test profile** — preserves the sandbox for the next revision of the same PR.

The review UI must always display `Isolated test data` and the resolved sandbox path. If isolation cannot be confirmed, **Run Bloom** and **Test separately** remain disabled.

## Storage design

### Measured Bloom footprint

On Parks's current development checkout on 2026-08-30:

| Data | Approximate size |
| --- | ---: |
| Shared Git history | 3.9 MiB |
| `node_modules` | 143.9 MiB |
| Rust `src-tauri/target` build output | 7.14 GiB |
| Frontend `dist` | 0.6 MiB |

Git worktrees share the repository's Git object database, so branches and tracked source files are comparatively small. Rust build output is the storage risk. A naive complete build cache in every task could consume more than 21 GiB for only three tasks.

### Required storage controls

- Use one shared development `CARGO_TARGET_DIR` per developer application, not a separate Rust target folder inside every task.
- Permit only one Workshop-managed Cargo/Tauri build at a time so shared artifacts cannot race.
- Keep owner review builds in a separate Manager-owned shared cache from contributor builds.
- Install `node_modules` only when the task first needs checks or a development launch.
- Do not duplicate Git history for each task; create real Git worktrees from one base clone.
- Keep downloaded Git objects, npm's global cache, Cargo's registry cache, and Gradle's global cache shared through their normal user-level locations.
- Track task source, generated dependencies, runtime sandbox, screenshots, and build cache as separate storage categories.
- Check available disk space before dependency installation, importing a test instance, or starting a build.
- Warn before a task operation would cross the configured storage budget.
- Never delete a dirty, uncommitted, unpushed, running, or unresolved task to recover space.

With a shared Rust build cache, a realistic starting footprint is roughly one 7.14 GiB cache per developer plus about 144 MiB for each prepared task, rather than 7+ GiB per task. The shared cache can still grow as dependencies and toolchains change, so it needs visible maintenance.

### Storage dashboard

Both applications should include a small **Storage** page showing:

- Total space used by Workshop or Manager.
- Shared Rust build cache size.
- Each task or review folder's source, dependencies, sandbox, and captures.
- Whether a task is active, paused, merged, closed, dirty, or safely removable.
- Current free disk space.

Provide these safe actions:

- **Pause and free generated files** — stops a task and removes only its reproducible `node_modules`, `dist`, and task-local generated files while keeping source and commits.
- **Clean shared build cache** — available only when no managed build or client is running; explains that the next build will take longer.
- **Remove finished task** — available only when the PR is merged/closed, the remote commits exist, and the worktree is clean.
- **Review before cleaning** — shows exact paths and estimated recovered space before confirmation.

Default policy should suggest cleanup for clean merged/closed tasks after 14 days and keep no more than three prepared inactive tasks. Suggestions are not silent deletion. Dirty or unpushed work remains until the developer resolves it explicitly.

## Safety rules enforced by the applications

- Never commit or develop directly on `main`.
- Never push to upstream from Bloom Workshop.
- Never force-push `main` or an upstream branch.
- Allow `--force-with-lease` only for the contributor's own rebased feature branch, with an explicit explanation.
- Never discard, reset, clean, or overwrite a folder containing uncommitted work.
- Never silently stash changes.
- Never kill a running development client or editor automatically.
- Never merge with failed required checks, unresolved review comments, or an untested newer commit.
- Never expose release actions to contributor builds.
- Never turn the pull-request test into a release automatically.
- Never let a development or review client read or write the installed Bloom Client's live data profile.

## Additional high-value features

### Build in the first useful version

- **Environment Doctor** — checks GitHub login, remotes, Node, Rust, Tauri prerequisites, free space, and port availability with one repair-oriented summary.
- **Conflict Radar** — compares the task's changed files with other open Bloom PRs and warns Parks and the contributor when two people are editing the same area.
- **Protected-file Guard** — explains and blocks changes to versioning, signing, release workflows, credentials, and private-tool boundaries before anything is pushed.
- **Exact Commit Receipt** — records the commit hash Parks launched and tested. A new contributor commit immediately marks that review as stale.
- **Change-type Checklists** — UI, launcher, backend, updater, and data-migration tasks receive short relevant test lists instead of one generic checklist.
- **Resume Safely** — after a crash or restart, reconstructs task state from Git and GitHub instead of trusting incomplete UI state.
- **Operation History** — records human-readable actions such as branch creation, checks, push, PR update, test launch, approval, and cleanup without recording credentials.
- **AI Workspace Handoff** — opens the exact task folder in the selected assistant and copies a prompt containing the task, branch, repository guidance, and protected boundaries.
- **Dependency-change Warning** — calls out modifications to lockfiles, Rust dependencies, Tauri permissions, and build scripts for special review.
- **Behind-main Assistant** — explains when upstream changed and performs a guarded update of the contributor branch without touching another task.

### Add after the core workflow is proven

- **Before/after capture** — attaches selected screenshots or a short recording to the PR without searching for files manually.
- **Review packet** — one page containing summary, changed files, checks, captures, known risks, commit hash, and exact manual test steps.
- **Task decision notes** — preserves important design decisions and unresolved questions with the PR instead of creating a private chat silo.
- **Notifications** — local notices for requested changes, passed checks, approval, merge, and a newer revision awaiting Parks's retest.
- **Test-data templates** — owner-approved fake profiles and instances that developers can copy into isolated sandboxes without exposing personal data.
- **Open failure details** — expands a failed check into the useful final error and offers the full log separately.

### Deliberately exclude

- A custom chat system.
- A replacement for GitHub issues, pull requests, reviews, or branch protection.
- Automatic merging or automatic releases.
- Shared owner credentials or contributor access to release controls.
- An embedded AI model in the first version; opening the developer's chosen assistant at the correct isolated folder is simpler and safer.

## UI direction

Both applications should visually match Bloom Client without copying the full launcher layout:

- OLED background and existing Bloom type hierarchy.
- Layered platform headers where they improve orientation.
- Dark borders darker than their surfaces.
- One accent color for progress and primary actions.
- Minimal subtext; explanations appear only for a decision, warning, or failure.
- Large state cards with one obvious next action.
- Existing Bloom button motion and accessibility preferences.
- No terminal output in the normal view. A collapsible **Technical details** area is available when a command fails.

The contributor home screen should contain three areas only:

1. Current task.
2. Next required action.
3. Recent tasks.

The owner Reviews screen should contain:

1. Pull requests needing attention.
2. Pull requests waiting on the contributor.
3. Recently merged work.

## Recommended implementation

### Bloom Workshop

- Build as a separate Tauri desktop application.
- Keep it outside the Bloom Client product repository so client releases do not ship developer tooling.
- It may live in a separate private developer-tools repository shared with approved contributors because it contains no owner release material.
- Package it as a normal Windows installer with its own icon, name, config directory, and updater policy.
- Reuse the safe logic from `scripts/review-pr.ps1` conceptually, but implement operations as structured commands with validated paths and readable results.

### Bloom Manager: Reviews

- Extend the existing private Manager locally.
- Reuse `scripts/review-pr.ps1` behavior for the first version, then move the validated worktree operations behind native Manager commands.
- Keep the existing GitHub identity check and release gates.
- Keep Manager source, binaries, credentials, and signing configuration outside the public Bloom Client repository.

## Build order

### Phase 1 — contributor minimum viable app

- Onboarding and environment validation.
- Fork/upstream validation.
- Start task in an isolated worktree.
- Open editor and run Bloom.
- Changed-file review.
- Required checks.
- Commit, push, and create/update draft PR.
- PR/check/review status.

### Phase 2 — owner review panel

- List and filter open PRs.
- Show checks and changed files.
- One-click isolated test and refresh.
- Record the commit Parks tested.
- Approve, request changes, squash-merge, and clean review worktree.

### Phase 3 — coordination polish

- Early draft-PR task ownership.
- Screenshot/recording attachment assistance.
- AI-assistant task prompt generation from repository guidance.
- Notifications for requested changes, passed checks, approval, and merge.
- Safe cleanup and archived task history.

## Definition of success

A contributor can go from a short task name to a reviewed PR without typing Git commands. Parks can see, test, review, and merge that PR without switching or modifying his active workspace. Neither application changes the underlying GitHub protections, and only the private owner Manager can publish Bloom Client updates.

## Implementation status — August 30, 2026

The first Bloom Workshop application now exists as a separate Tauri project at `C:\Users\Parks\Documents\BloomWorkshop`. It includes onboarding, environment checks, contributor fork/base-clone preparation, isolated Git worktrees, task-only Bloom data and WebView profiles, protected-file gates, exact check receipts, draft pull-request handoff, review status, conflict radar, storage reporting, and scoped cleanup. Its frontend and Rust layers compile successfully, and the real desktop onboarding/environment-check flow has been visually verified.

Bloom Client's debug backend recognizes an absolute `BLOOM_DEV_DATA_DIR` override so Workshop-launched development builds cannot touch the installed client profile. Release builds ignore that override. Workshop also sets a task-specific `WEBVIEW2_USER_DATA_FOLDER` and uses port `1435` for its own interface so Bloom can continue using port `1420`.

The private Bloom Manager remains the only release application. Workshop contains no merge, tag, release, publish, signing, or upstream-push action.
