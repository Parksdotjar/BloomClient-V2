# Bloom Client on Apple Silicon

Mac platform integration and a native build/test workflow are implemented. Windows checks pass locally. The Mac job and hands-on Mac acceptance have **not** been run from this Windows workspace. This is not a verified public Mac release.

## Architecture and scope

The initial acceptance target is Apple Silicon on macOS 14 or newer. This is a deliberate support floor, not a claim that every dependency requires macOS 14. Intel, Rosetta and universal binaries are outside this first target.

Keep one React interface, Tauri command API, instance format and Minecraft installation flow. OS integration belongs in `src-tauri/src/platform/`. Preserve Windows paths, Java discovery, Credential Manager, ZIP installation and NSIS settings. Do not migrate Windows data or rewrite Windows launch behavior for Mac.

| Integration | Windows | macOS |
| --- | --- | --- |
| Bloom data | `%APPDATA%/BloomClient` | `~/Library/Application Support/BloomClient` |
| Default instances | `%APPDATA%/.minecraft/instances` | `~/Library/Application Support/minecraft/instances` |
| Credentials | Windows Credential Manager | Keychain via `keyring/apple-native` |
| Private Java | Temurin Windows ZIP, `javaw.exe` | Temurin ARM64 tar.gz, `Contents/Home/bin/java` |
| Hardware | Existing PowerShell CIM scan | `sysctl`, `system_profiler`, CoreGraphics |
| Folder opening | Explorer | `/usr/bin/open` |
| Installer | Existing NSIS configuration | Mac override: `.app` and `.dmg` |

The `.minecraft/…` preference remains a portable alias; custom directories remain the real instance parent. Instance schemas and credential service/account identifiers stay compatible. Finder launches do not need a shell PATH: Java discovery checks system/user JavaVirtualMachines folders, JAVA_HOME and Apple's locator. Mac Java candidates must match the launcher's native architecture. Automatic installation still works without a system Java installation.

Java downloads retain SHA-256 verification before extraction. Mac extraction preserves executable permissions and internal links while rejecting traversal, escaping links and writes through symlink ancestors. Extraction failures/cancellation clean staging. Windows retains ZIP extraction. Missing provider JRE packages can fall back to JDK packages; provider errors never bypass verification.

AutoTune uses the same Minecraft 26.3 benchmark and measured profile logic. Unknown refresh rates, including variable-refresh modes reporting zero, are disclosed as a 60 FPS fallback. Memory headroom limits also apply to unified system memory. Hardware detection alone does not establish gameplay performance.

## Build on the M-series Mac

### Easiest installer handoff from Windows

Use GitHub Actions to build on its Apple Silicon runner, then download the DMG to Windows and share the file. The tester does not need Node, Rust, Java build tools or the source checkout. With owner authorization, push the current client build sources and `desktop-platforms.yml` to `codex/macos-test-build`; the workflow runs on that test branch without merging into main or publishing a release. Its `bloom-macos-apple-silicon-acceptance` artifact contains the DMG. Download and extract GitHub's artifact ZIP before sending the DMG through Discord or a file-sharing link. This is still an unnotarized test build, so Mac security approval may be needed. Actual build success and gameplay acceptance must be established before presenting it as ready.

The existing Bloom Admin application is a Windows content editor. Adding a DMG button would need to trigger this cloud Mac build or connect to another Mac; it would not compile the Mac bundle locally on Windows.

### Local Mac build alternative

Install Xcode Command Line Tools, native ARM64 Node 22+, native stable Rust, and a native JDK 25. Set JAVA_HOME to the JDK's `Contents/Home`. Use a checkout containing the full current source, including Sakura, benchmark and cosmetics files. Do not copy Windows `node_modules`, `target` or Gradle caches. This workspace contains substantial uncommitted work: a fresh upstream checkout alone will not contain this implementation.

```sh
npm ci
npm run mac:check
npm run mac:dev
```

`mac:check` checks the host, builds all four cosmetics variants, Sakura and the frontend, then runs the locked native check and non-ignored Rust tests. Unix Gradle runs through `sh`, so its tracked non-executable mode does not break clean checkouts. Additional checks:

```sh
sh benchmark-mod/gradlew -p benchmark-mod test --no-daemon
node --test tests/platform-build.test.mjs tests/updater-manifests.test.mjs
node --experimental-strip-types --test tests/autotune.test.ts
npm run mac:build
```

The acceptance app appears under `src-tauri/target/release/bundle/macos/` and DMG under `src-tauri/target/release/bundle/dmg/`. `mac:build` disables updater artifact generation for that invocation, avoiding a private updater signing key requirement. Shipping configuration and Windows commands remain intact. The helper does not provision credentials or publish. Existing Tauri signing environment configuration, if present on the build machine, still applies. An unnotarized acceptance artifact is not ready for public distribution.

Tauri automatically merges `tauri.macos.conf.json` on Mac. Its resources array replaces the Windows resource mapping. Cosmetics and benchmark JARs remain embedded by Rust. Sakura is staged as a target-suffixed Tauri sidecar, bundled beside Bloom in `Contents/MacOS/sakura`. Mac release launches resolve that path; Windows retains `resources/sakura/sakura.exe`. Debug launches retain the optimized development engine path.

`.github/workflows/desktop-platforms.yml` adds independent Windows and `macos-15` Apple Silicon jobs. It checks frontend/native code, builds all cosmetics versions, tests benchmark instrumentation, builds a Mac acceptance DMG, verifies packaged ARM64 binaries and probes Sakura capabilities. It uploads only a short-lived CI artifact, has read-only repository permissions, and references no release secrets. Existing check/release workflows are unchanged by this task. The new job runs only after source is committed/pushed through the normal owner workflow.

## Hands-on acceptance required

Record Mac model, macOS version, display/refresh mode, build identifier, expected/actual result and redacted logs. Test the installed app from Finder with Terminal closed as well as development mode.

- Install into Applications, launch from Finder, quit/reopen and reboot. Verify Minecraft and Social session persistence in Keychain, account switching and sign-out. Never attach credential-store contents to logs.
- Launch Vanilla and Fabric for **1.21.11, 26.1, 26.2 and 26.3**. Test Automatic Java on a fresh profile, manual ARM64 Java, wrong-architecture Java, download cancellation/retry and repair.
- Complete AutoTune: download, benchmark, log/report copy, review, apply and reopen. Exercise interruption/retry and unknown display refresh. Keep Minecraft focused throughout measurement.
- Check mods, resource/shader packs, capes, skins, emotes, screenshots, export/import, content copying, spaces/non-ASCII paths, Global File Sync and instance duplication/deletion. Test external drives separately; local APFS unit tests do not prove every filesystem works.
- Check themes, Retina scaling, minimum window size, menus, Cmd+C/V/K, file dialogs, drag/drop, clipboard text/images, browser authentication, interaction sounds, WebGL skin previews, window controls and fullscreen in native WKWebView.
- Check Social messaging, image sharing, reconnect and encrypted identity restoration using authorized test accounts. Fixtures do not establish live service health.
- Exercise **Sakura Alpha's existing vanilla 26.1 scope** on a real server: Metal rendering, assets, input/cursor capture, resize/Retina, audio/device changes, reconnect and process cleanup. Capability probing does not establish rendering/audio parity or add Java mods to Sakura.
- Repeat Windows sign-in/launch/AutoTune/cosmetics/installer/update acceptance before release. Windows CI is a regression guard, not installed-client acceptance.

## Public distribution and updates

Developer ID signing, notarization, updater signing and publication remain a separately authorized owner step. Do not change the embedded updater public key or expose private signing material. Local/CI acceptance DMGs have not passed Gatekeeper/notarization acceptance; prefer a locally built development app for initial testing.

Production needs one updater manifest containing both Windows entries and `darwin-aarch64`. Mac must point to a signed `.app.tar.gz` updater artifact, not the DMG. The existing Windows release workflow has not been changed to publish Mac artifacts. Integrate both outputs into the owner release transaction before enabling public Mac updates; otherwise a later Windows publication can remove the Mac entry.

The new merge helper prepares a local candidate, preserving the first manifest's notes/date and all Windows URLs/signatures. It requires matching versions and refuses conflicting targets or missing signatures. It does not cryptographically verify signatures or upload anything:

```sh
node scripts/merge-updater-manifests.mjs windows.json mac.json > combined.json
```

Use a new output filename. Verify artifacts against the existing updater trust key, review the candidate and test installed Windows and Mac updates before owner-authorized publication. Shipping signing configuration is not supplied or modified here.

## Local verification — November 10, 2026

- `npm run typecheck`, `npm run build` and locked Cargo check: passed on Windows. Existing Vite large-chunk warning remains.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`: 69 passed, 3 existing authenticated/gameplay tests ignored.
- Platform/updater Node tests: 4 passed. AutoTune TypeScript tests: 7 passed.
- Build helper syntax checks and `git diff --check`: passed. Tauri's actual config type accepts the merged Mac configuration.
- Live Adoptium ARM64 Mac Java 21/25 metadata succeeded with Bloom's actual User-Agent. Downloaded the Java 25 JRE archive, verified its provider SHA-256 and inspected all 333 entries: the expected `Contents/Home/bin/java` is present with mode 0755; this package contains no links. No Mac executable was run on Windows. Extraction tests use generated Windows ZIP and Mac-layout tar.gz fixtures. Unix permission/symlink tests and Mac hardware checks are included for native CI but were not executed here.
- No Mac compilation, DMG installation, Keychain persistence, native WKWebView test, Mac gameplay, notarization or updater installation is claimed. No commits, pushes, tags, application version changes or publication occurred.

References: [Tauri platform configuration](https://v2.tauri.app/develop/configuration-files/), [sidecars](https://v2.tauri.app/develop/sidecar/), [Mac signing](https://v2.tauri.app/distribute/sign/macos/), [updater artifacts](https://v2.tauri.app/plugin/updater/), [GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
