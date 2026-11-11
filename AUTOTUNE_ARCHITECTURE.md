# AutoTune

AutoTune measures a private Minecraft Java 26.3 workload, derives conservative recommendations and saves them only after the user's Apply confirmation. It does not promise a measured uplift or optimal settings for every world. The older standalone WebView graphics benchmark is not used by this workflow.

## Boundaries

- `src/components/AutoTune.tsx` owns the workflow, native-status polling, result review, reasons, confirmed apply, optional mod links and a 120-entry session log. `src/main.tsx` retains the existing hardware onboarding. Polls do not overlap; teardown ignores late responses. Launch and installation errors, early exits, repeated read failures and long waits terminate the progress view.
- `src/services/autotune.ts` owns the complete native launch payload, schema validation and pure tuning calculations. Each result must be schema 2, stable 26.3, uninterrupted and mathematically consistent. Hardware estimates alone cannot become a measured profile. Native validation independently checks this boundary before Apply.
- `src-tauri/src/autotune.rs` protects the managed folder, bounds benchmark heap size, clears stale artifacts and writes a fresh UUID. It deletes only the named test world after verifying the folder marker; it refuses linked folders and unmarked existing directories. Reinstallation clears the marked private instance. Personal instances are not installation targets.
- The benchmark uses pinned Fabric Loader 0.19.5 / Fabric API 0.163.0+26.3 and the embedded `bloom-autotune-benchmark-26.3.jar`. Global File Sync and cosmetics reconciliation/session preparation are skipped for this instance. The test is hidden from the library.
- Java instrumentation performs 15 seconds of warm-up and 60 seconds of measurement. It retains long stalls, computes the mean slowest 1% frame times and nearest-rank p95, and rejects focus/menu interruptions. JSON replacement prevents ordinary polling from observing partial writes; status writes are throttled. The native reader checks result/run-ID equality.
- Both the benchmark and recommendations reserve system memory. Recommendations remain within the 12/8 measured distances; frame spikes do not independently justify changing collectors. Peak Java heap is not total process or system memory. Display refresh is a target, not a guarantee.
- Apply excludes hidden and Sakura instances and refuses an active game/download. It snapshots affected instance/options files, writes eligible Java settings and publishes future defaults last. Reported errors restore the snapshots and identify restoration failure. This is rollback for ordinary errors, not a power-loss-safe multi-file transaction. Fullscreen, VSync and unrelated options remain unchanged. Existing custom JVM arguments are replaced, as stated in confirmation.
- The final screen confirms native persistence and exposes reasons and mod project links. Sodium, Lithium and FerriteCore are optional suggestions; users must select compatible versions/loaders. No mod is installed automatically. Project sources: [Sodium](https://modrinth.com/mod/sodium), [Lithium](https://modrinth.com/mod/lithium), [FerriteCore](https://modrinth.com/mod/ferrite-core).

## Validation and rebuilding

With JDK 25 selected in `JAVA_HOME`:

```powershell
./benchmark-mod/gradlew.bat -p benchmark-mod stageBenchmark --no-daemon
node --experimental-strip-types --test tests/autotune.test.ts
npm run typecheck
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml autotune
```

`stageBenchmark` runs Java sampler regression tests and updates the embedded JAR. Commit the matching source and JAR together; Cargo embeds the JAR at compile time. Application VERSION remains independent.

Run Vite at port 1422, then `node tests/autotune-ui.mjs` with Playwright available (`PLAYWRIGHT_MODULE` / `CHROME_PATH` can point to existing installations). `AUTOTUNE_SCREENSHOTS` optionally captures visual checks. This exercises the real React app with a native fixture: launch payload, retry, early process exit, result review, confirmation, failure/success, optional links, logs, restored completion and compact Light layout. It does not authenticate a Minecraft account.

For an isolated game smoke test, `runClient -PbenchmarkSmoke` uses `benchmark-mod/build/smoke-1280`. A `.bloom-autotune-managed` marker, `bloom-benchmark-run-id.txt`, and the options emitted by `write_autotune_options` opt into managed operation there. The run must keep the game focused and should exit automatically after saving a valid result. This development run validates the actual mod/world/result pipeline separately from Microsoft authentication and Tauri distribution.

## Limits

Only 26.3 has bundled instrumentation in this workflow. The settings can be applied to other Java versions, but the benchmark does not measure their behavior. Modpacks and shaders may need more RAM or different settings. One rotating fixed-seed scene cannot fully characterize exploration, a server or CPU/GPU bottlenecks; there is no repeated-run confidence interval or post-apply A/B test. Warm-up is fixed, so close competing workloads before comparing runs. Future version support requires a matching build and test, not a cosmetic selector.


## Verification — November 10, 2026

Passed TypeScript typecheck, production frontend build, locked Cargo check, six TypeScript regressions, six native AutoTune regressions (including real write-failure rollback on Windows), three Java sampler regressions and the browser workflow checks in OLED/Light. The build retains the existing large-bundle warning.

Two actual isolated Minecraft 26.3 development runs created the fixed world, completed 60-second measurement, saved schema-2 results and exited automatically. The second used the intended 1280 × 720 window; its result passed frontend validation. These runs verify instrumentation, not a performance improvement: other development work was active, and Microsoft sign-in plus a packaged Tauri launch was not exercised. Browser native-command responses are fixtures. Special review areas are native apply/rollback, the private-world reset and the rebuilt embedded benchmark JAR; unrelated pre-existing work remains in the checkout.
