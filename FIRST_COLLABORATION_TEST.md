# First Collaboration Test: Karsten to Parks

This is a disposable practice run for the Bloom contribution workflow. Karsten will make one obvious temporary UI change in his fork, open a draft pull request, and Parks will run that pull request in an isolated copy of Bloom Client.

The practice change must **not** be merged. When the test is complete, close the pull request and delete the practice branch. A successful test leaves upstream `main`, Parks's working files, and the Release Manager untouched.

## Before starting

Both developers need:

- Their own GitHub account.
- Git, Node.js/npm, Rust, and the Tauri prerequisites used by Bloom Client.
- Their own local Bloom Client folder. Never share or sync the same working folder.

Karsten does **not** need repository write access, the Release Manager, release credentials, or signing keys. He contributes through a fork.

The number `123` shown in other examples is only a placeholder. Parks must use the real pull-request number GitHub creates, such as `7` or `18`.

## Part 1: Karsten creates his independent copy

1. Sign in to GitHub as Karsten.
2. Open [Parksdotjar/BloomClient-V2](https://github.com/Parksdotjar/BloomClient-V2).
3. Click **Fork**, keep the repository name `BloomClient-V2`, and create the fork under Karsten's account.
4. On Karsten's computer, open PowerShell or Command Prompt in the folder where he keeps projects.
5. Clone **Karsten's fork**, replacing `KARSTEN_GITHUB_USERNAME` with his real GitHub username:

   ```powershell
   git clone https://github.com/KARSTEN_GITHUB_USERNAME/BloomClient-V2.git
   cd BloomClient-V2
   ```

6. Connect his clone to Parks's repository and confirm both remotes:

   ```powershell
   git remote add upstream https://github.com/Parksdotjar/BloomClient-V2.git
   git remote -v
   ```

   `origin` must point to Karsten's fork. `upstream` must point to `Parksdotjar/BloomClient-V2`.

7. Install the project dependencies:

   ```powershell
   npm ci
   ```

## Part 2: Karsten makes the disposable test branch

1. Start from the newest upstream `main` and create a separate branch:

   ```powershell
   git fetch upstream
   git switch -c karsten/workflow-smoke-test upstream/main
   ```

2. Confirm that he is **not** on `main`:

   ```powershell
   git branch --show-current
   ```

   The result must be `karsten/workflow-smoke-test`.

3. Open `src/main.tsx` in his editor.
4. Find this sidebar brand text:

   ```tsx
   <b>Bloom Client</b>
   ```

5. Change only that occurrence to:

   ```tsx
   <b>Bloom Client Test</b>
   ```

6. Inspect the change. It should show only the one intended line:

   ```powershell
   git diff -- src/main.tsx
   git status --short
   ```

7. Run the fast local checks:

   ```powershell
   npm run typecheck
   npm run build
   ```

8. Karsten may run `npm run tauri dev` to visually confirm the temporary name. If Windows Application Control blocks a generated Rust file, he should report that limitation instead of weakening Windows security; GitHub's `rust` check still validates the Rust project.

9. Commit and push the practice branch to Karsten's fork:

   ```powershell
   git add src/main.tsx
   git commit -m "test: verify collaboration workflow"
   git push -u origin karsten/workflow-smoke-test
   ```

## Part 3: Karsten opens the draft pull request

1. Open Karsten's fork on GitHub. GitHub should offer **Compare & pull request** for the newly pushed branch.
2. Set these exact destinations:

   - Base repository: `Parksdotjar/BloomClient-V2`
   - Base branch: `main`
   - Head repository: Karsten's fork
   - Compare branch: `karsten/workflow-smoke-test`

3. Select **Create draft pull request**.
4. Use the title `test: verify collaboration workflow`.
5. In the description, state that this is a disposable workflow test, identify the one changed line, and list the checks he ran.
6. Send Parks the GitHub pull-request link or its real number. For example, if the link ends in `/pull/7`, the number Parks needs is `7`.
7. Wait for the `frontend` and `rust` GitHub checks. A red check must be investigated; it must not be ignored just because the visual change works.

## Part 4: Parks tests the pull request without touching his work

1. Keep the primary Bloom folder exactly as it is. Uncommitted work there does not need to be discarded or stashed.
2. If Bloom's normal Tauri development client is already running, stop that development process with `Ctrl+C` immediately before launching the review copy. Both copies use port `1420`, so they cannot run at the same time. This does not delete or change either copy.
3. In Parks's primary Bloom folder, list the real open pull requests:

   ```powershell
   gh pr list --repo Parksdotjar/BloomClient-V2
   ```

4. Replace `REAL_PR_NUMBER` with the number GitHub created and launch the isolated review copy:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/review-pr.ps1 -PullRequest REAL_PR_NUMBER -Launch
   ```

   Do not literally enter `123` or `REAL_PR_NUMBER`.

5. The helper creates a sibling folder such as:

   ```text
   C:\Users\Parks\Documents\BloomClient-PR-Reviews\PR-7
   ```

   Parks's primary `BloomClient-V2-main` folder remains on its existing branch with its existing local edits.

6. **Current limitation:** the helper isolates the source checkout, but the present Bloom development backend still resolves runtime data below `%APPDATA%\BloomClient`. Until the debug-profile isolation described in `DEVELOPER_WORKFLOW_APP_SPEC.md` is implemented, keep this disposable smoke test visual and read-only. Do not sign in, create/delete/launch instances, import content, reset settings, run AutoTune, or change stored data from the review client.
7. In the review client, verify that the sidebar says **Bloom Client Test**.
8. Navigate only through read-only UI needed to confirm that the temporary label renders correctly.
9. Close the review Tauri window and stop its review terminal with `Ctrl+C` when finished.

## Part 5: Practice the revision loop

This step proves that Karsten can respond to review without opening another pull request.

1. Parks comments on the draft PR: `Please change the temporary text to Bloom Client PR Test.`
2. Karsten stays on `karsten/workflow-smoke-test`, makes that exact text change, and pushes another commit:

   ```powershell
   git add src/main.tsx
   git commit -m "test: address workflow review"
   git push
   ```

3. The existing pull request updates automatically. Karsten does **not** open a second PR.
4. Parks stops the old review process, then reruns the same review command with the same PR number:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/review-pr.ps1 -PullRequest REAL_PR_NUMBER -Launch
   ```

5. Parks verifies the updated wording. This confirms that review feedback, new commits, GitHub checks, and isolated retesting all work end to end.

## Part 6: Clean up the disposable test

1. Parks closes the draft pull request on GitHub. Do **not** click merge for this practice change.
2. After the review client and terminal are closed, Parks removes the isolated review folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/review-pr.ps1 -PullRequest REAL_PR_NUMBER -Remove
   ```

3. Karsten deletes the remote practice branch and returns to `main` in his fork:

   ```powershell
   git push origin --delete karsten/workflow-smoke-test
   git switch main
   git fetch upstream
   git merge --ff-only upstream/main
   git push origin main
   ```

   If the fast-forward merge refuses to run, stop and inspect why instead of forcing it. A normal contributor `main` should contain no private commits or unfinished work.

4. Parks can restart his normal development client from his primary folder:

   ```powershell
   npm run tauri dev
   ```

## What changes for a real task

For real work, use a descriptive branch such as `karsten/fix-mod-search`, make only the requested product change, and open a normal pull request instead of a disposable draft. Parks tests it with the same isolated review command. When GitHub checks pass, requested changes are resolved, and Parks approves the result, Parks uses **Squash and merge** on GitHub.

Merging a real pull request adds reviewed code to `main`; it does not publish an update. Only Parks later uses the private Release Manager from a clean, synchronized `main` to create the version commit, tag, signed build, and GitHub release.

## Success checklist

- Karsten worked only in his fork and `karsten/workflow-smoke-test` branch.
- GitHub created a draft PR with both required checks.
- Parks used the real PR number, not `123`.
- Parks ran the PR from `BloomClient-PR-Reviews`, while his primary folder remained untouched.
- Karsten pushed a revision to the same PR and Parks saw the revision after refreshing the review copy.
- The practice PR was closed without merging.
- The review worktree and practice branch were removed.
- No version, tag, release, Manager file, credential, or upstream `main` content changed.
