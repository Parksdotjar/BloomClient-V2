# Bloom Client V2

> A clean, open-source Minecraft desktop client built with Tauri, React, TypeScript, Vite, and Rust.

Bloom Client V2 is a fresh rebuild focused on a fast launcher experience, a maintainable codebase, and a welcoming open-source workflow. The frontend owns presentation and user interaction; Rust owns native Windows operations; Tauri is the bridge between them.

## Architecture

```text
React + TypeScript UI
          |
       Tauri API
          |
      Rust commands
          |
Windows, files, downloads, Java, Minecraft
```

| Area | Responsibility |
| --- | --- |
| `src/` | React screens, components, frontend services, and shared types |
| `src-tauri/` | Rust commands and native platform integration |
| `src-tauri/src/commands/` | Small, focused command modules exposed to the frontend |
| `.github/workflows/` | Reproducible checks and desktop builds |

## Development

### Prerequisites

- Node.js 20+
- Rust stable
- Tauri prerequisites for Windows
- Git

### Run locally

```powershell
npm install
npm run tauri dev
```

### Quality checks

```powershell
npm run typecheck
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Git workflow

Keep `main` stable. Create a focused branch for each change, make small conventional commits, and open a pull request:

```powershell
git pull --rebase origin main
git switch -c feat/your-change
git add .
git commit -m "feat: describe the change"
git push -u origin feat/your-change
```

Pull requests should explain the user-facing change, include screenshots for UI work, and pass the checks before merging.

## Project status

Bloom Client V2 is in early foundation work. APIs and UI surfaces may change while the core launcher architecture is being built.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development expectations and pull-request checklist. Please report bugs with the issue template and discuss larger features before starting implementation.

## License

Released under the MIT License. See [LICENSE](LICENSE).
