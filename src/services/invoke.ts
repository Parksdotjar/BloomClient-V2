import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { userError } from "./user-error";

export async function invoke<T>(...args: Parameters<typeof nativeInvoke>): Promise<T> {
  try { return await nativeInvoke<T>(...args); }
  catch (error) { throw userError(error); }
}
