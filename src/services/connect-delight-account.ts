import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./invoke";

export const socialDirectoryChanged = "delight-social-directory-changed";

/** Open Delight's account approval and wait for the launcher session. */
export async function connectDelightAccount(signal?: AbortSignal) {
  const start = await invoke<{ authorizationUrl: string }>("social_prepare_sign_in");
  signal?.throwIfAborted();
  await openUrl(start.authorizationUrl);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 650));
    signal?.throwIfAborted();
    if (await invoke("social_poll_sign_in")) {
      window.dispatchEvent(new Event(socialDirectoryChanged));
      return;
    }
  }
  throw new Error("Sign-in timed out. Try again when you are ready.");
}
