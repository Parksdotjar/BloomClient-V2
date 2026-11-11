import { spawnSync } from "node:child_process";
import { release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
if (!["dev", "check", "build"].includes(action)) throw new Error("Use mac:dev, mac:check or mac:build.");
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Build Bloom for Mac on an Apple Silicon Mac with native ARM64 Node and Rust. Windows commands are unchanged.");
}
if (Number(release().split(".")[0]) < 23) throw new Error("The initial Mac build targets macOS 14 or newer.");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const rust = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
if (rust.status !== 0 || !rust.stdout.includes("host: aarch64-apple-darwin")) {
  throw new Error("Install the native aarch64-apple-darwin Rust toolchain; a Rosetta toolchain would mix architectures.");
}
if (process.env.CARGO_BUILD_TARGET) {
  throw new Error("Unset CARGO_BUILD_TARGET for Bloom’s native Mac build so the launcher and Sakura use the expected output paths.");
}
if (action === "dev") run("npm", ["run", "tauri:dev"]);
else if (action === "check") {
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "build:tauri"]);
  run("cargo", ["check", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--lib"]);
} else {
  // A local acceptance build. The shipping config and Windows updater artifacts remain enabled.
  // This helper does not provision credentials or publish; shipping signatures remain a separate release step.
  run("npm", ["run", "tauri:build", "--", "--config", '{"bundle":{"createUpdaterArtifacts":false}}']);
}
