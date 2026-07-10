# Contributing to BlimClient V2

Thanks for helping make BlimClient better.

## Before you start

For a significant feature, open an issue first so the design and scope are clear. Small bug fixes and documentation improvements can go directly into a pull request.

## Pull requests

- Keep changes focused and easy to review.
- Use a conventional commit message such as `feat:`, `fix:`, `docs:`, or `refactor:`.
- Run the frontend typecheck/build and Rust checks locally.
- Include screenshots or a short recording for visual changes.
- Explain testing steps and any platform-specific behavior.

## Code shape

Keep React code concerned with UI and state. Put native filesystem, process, download, and Java behavior behind typed Tauri commands in Rust. Prefer small modules with clear names over large multipurpose files.
