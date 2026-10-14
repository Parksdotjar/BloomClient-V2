import { copyFileSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = resolve(root, "benchmark-mod", process.platform === "win32" ? "gradlew.bat" : "gradlew");
const project = resolve(root, "bloom-cosmetics-mod");
// Validate the compiler before invoking the wrapper so a missing JDK has one
// actionable error, rather than a cascade of Windows batch errors.
const configuredHome = process.env.JAVA_HOME?.replace(/^"|"$/g, "");
const compiler = configuredHome
  ? resolve(configuredHome, "bin", process.platform === "win32" ? "javac.exe" : "javac")
  : "javac";
const javaVersion = spawnSync(compiler, ["-version"], { encoding: "utf8" });
const major = Number(`${javaVersion.stdout ?? ""} ${javaVersion.stderr ?? ""}`.match(/javac (\d+)/)?.[1]);
if (javaVersion.status !== 0 || major < 21 || !major) {
  console.error("Bloom Cosmetics requires JDK 21 or newer. Install a JDK and set JAVA_HOME to its installation folder (not its bin folder), then reopen PowerShell and retry npm.cmd run tauri dev.");
  process.exit(1);
}
const buildEnv = { ...process.env };
if (configuredHome) {
  buildEnv.JAVA_HOME = configuredHome;
  buildEnv.PATH = `${resolve(configuredHome, "bin")}${delimiter}${process.env.PATH ?? ""}`;
}
const result = process.platform === "win32"
  ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `& '${wrapper.replaceAll("'", "''")}' -p '${project.replaceAll("'", "''")}' build --no-daemon; exit $LASTEXITCODE`,
    ], {
      cwd: root,
      stdio: "inherit",
      env: buildEnv,
    })
  : spawnSync(wrapper, ["-p", project, "build", "--no-daemon"], {
      cwd: root,
      stdio: "inherit",
      env: buildEnv,
    });

if (result.status !== 0) process.exit(result.status ?? 1);

const libraries = resolve(project, "build", "libs");
const builtJar = readdirSync(libraries)
  .filter((name) => /^bloom-cosmetics-1\.21\.11-[\w.-]+\.jar$/.test(name) && !name.includes("sources"))
  .map((name) => ({ name, modified: statSync(resolve(libraries, name)).mtimeMs }))
  .sort((left, right) => right.modified - left.modified)[0]?.name;
if (!builtJar) throw new Error("Bloom Cosmetics built successfully, but its remapped JAR was not found.");
const source = resolve(libraries, builtJar);
const destination = resolve(root, "src-tauri", "resources", "bloom-cosmetics-1.21.11.jar");
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
writeFileSync(destination.replace(/\.jar$/, ".sha256"), createHash("sha256").update(readFileSync(source)).digest("hex"));
console.log(`Bloom Cosmetics bundled at ${destination}`);
