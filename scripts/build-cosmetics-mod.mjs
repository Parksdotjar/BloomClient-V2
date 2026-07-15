import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = resolve(root, "benchmark-mod", process.platform === "win32" ? "gradlew.bat" : "gradlew");
const project = resolve(root, "bloom-cosmetics-mod");
const result = process.platform === "win32"
  ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `& '${wrapper}' -p '${project}' clean build --no-daemon`,
    ], {
      cwd: root,
      stdio: "inherit",
    })
  : spawnSync(wrapper, ["-p", project, "clean", "build", "--no-daemon"], {
      cwd: root,
      stdio: "inherit",
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
console.log(`Bloom Cosmetics bundled at ${destination}`);
