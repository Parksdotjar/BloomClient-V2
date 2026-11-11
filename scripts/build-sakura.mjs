import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const native = join(root, "sakura");
const executableName = process.platform === "win32" ? "sakura.exe" : "sakura";
const executable = join(native, "target", "release", executableName);
const receiptPath = join(native, "target", "release", ".bloom-build-cache.json");

async function fingerprint() {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ platform: process.platform, arch: process.arch, rustflags: process.env.RUSTFLAGS || "", encodedRustflags: process.env.CARGO_ENCODED_RUSTFLAGS || "" }));
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (["target", "local-server", ".git", "__pycache__"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(rs|wgsl|toml|lock|json|bin)$/.test(entry.name)) { hash.update(path.slice(native.length)); hash.update(await readFile(path)); }
    }
  }
  await visit(native);
  hash.update(await readFile(fileURLToPath(import.meta.url)));
  return hash.digest("hex");
}

async function executableStamp() {
  const info = await stat(executable);
  return `${info.size}:${info.mtimeMs}`;
}

const source = await fingerprint();
let receipt;
try { receipt = JSON.parse(await readFile(receiptPath, "utf8")); } catch { /* First build. */ }
let stamp;
try { stamp = await executableStamp(); } catch { /* First build. */ }
if (!stamp || receipt?.source !== source || receipt?.executable !== stamp) {
  console.log("Building Sakura's optimized native engine…");
  const build = spawnSync("cargo", ["build", "--release", "--locked", "--bin", "sakura"], { cwd: native, env: { ...process.env, CARGO_TARGET_DIR: join(native, "target") }, stdio: "inherit", windowsHide: true });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status || 1);
  stamp = await executableStamp();
  await writeFile(receiptPath, JSON.stringify({ source, executable: stamp }));
} else console.log("Sakura is unchanged; reusing the optimized engine.");

const probe = spawnSync(executable, ["--capabilities"], { encoding: "utf8", timeout: 5000, maxBuffer: 16384, windowsHide: true });
if (probe.error || probe.status !== 0) throw new Error("Sakura capability check failed after building.");
const capabilities = probe.stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(value => value.engine === "sakura");
if (!capabilities || capabilities.schema !== 1 || capabilities.minecraft !== "26.1") throw new Error("Sakura must match Bloom's pinned Minecraft 26.1 protocol.");
const resource = join(root, "src-tauri", "resources", "sakura", executableName);
const resourceReceipt = `${resource}.build.json`;
let copied;
try { copied = JSON.parse(await readFile(resourceReceipt, "utf8")); } catch { /* First bundle. */ }
const existingResource = await stat(resource).catch(() => null);
const resourceStamp = existingResource ? `${existingResource.size}:${existingResource.mtimeMs}` : null;
if (copied?.source !== source || copied?.executable !== stamp || copied?.resource !== resourceStamp) {
  await mkdir(dirname(resource), { recursive: true });
  await copyFile(executable, resource);
  const bundled = await stat(resource);
  await writeFile(resourceReceipt, JSON.stringify({ source, executable: stamp, resource: `${bundled.size}:${bundled.mtimeMs}` }));
}
console.log(`Sakura ${capabilities.stage}: optimized engine ready for Bloom.`);

// Tauri bundles Mac sidecars beside the app executable, preserving native code signing boundaries.
// Windows continues using the existing resources/sakura/sakura.exe path.
if (process.platform === "darwin") {
  const triple = process.arch === "arm64" ? "aarch64-apple-darwin" : process.arch === "x64" ? "x86_64-apple-darwin" : null;
  if (!triple) throw new Error(`Unsupported Mac architecture: ${process.arch}`);
  const sidecar = join(root, "src-tauri", "binaries", `sakura-${triple}`);
  await mkdir(dirname(sidecar), { recursive: true });
  await copyFile(executable, sidecar);
  await chmod(sidecar, 0o755);
}
