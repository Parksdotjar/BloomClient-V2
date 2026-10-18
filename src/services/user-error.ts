export const RATE_LIMIT_MESSAGE = "Whoa, slow down! Too many attempts. Please try again later.";

export function userError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Inspect the status/message, never the URL: IDs in URLs can contain 429.
  const summary = message.replace(/https?:\/\/[^\s)\]}>]+/gi, "");
  if (/\b429\b|too[ _-]many[ _-](?:requests|attempts)|rate[ _-]limit(?:ed|ing)?|slow[ _-]down/i.test(summary)) {
    return RATE_LIMIT_MESSAGE;
  }
  return message;
}
