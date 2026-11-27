import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startLocalWings } from "./dev-wings.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const lifetime = new EventEmitter();
await startLocalWings(root, lifetime);
if (!process.argv.includes("--service-only")) {
  const child = spawn(join(root, "Delight Client v1.3.5 - Color Picker.exe"), [], {
    cwd: root, stdio: "ignore", env: { ...process.env, DELIGHT_WINGS_LOCAL_PREVIEW: "1" },
  });
  child.on("exit", () => lifetime.emit("close"));
  child.on("error", error => { lifetime.emit("close"); throw error; });
}
