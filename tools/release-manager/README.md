# Bloom Release Manager

Owner-only desktop utility for publishing signed Bloom Client releases from the main repository.

Run it from the repository root:

```powershell
npm run release:manager
```

The launcher builds the local WinForms utility when its source changes, then opens it without a command window. It is a separate project and is never included in Bloom Client's Tauri application, installer, or updater artifacts.

The utility requires the repository to be clean and synchronized with `origin/main`. Publishing runs validation, updates `VERSION`, commits and pushes the synchronized version files, creates the matching Git tag, watches the GitHub release workflow, applies release notes, and optionally publishes the completed release.

GitHub authorization and updater signing secrets remain external to the utility. Possessing this source code does not grant release access.
