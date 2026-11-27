export function announceClipboardCopy() {
  window.dispatchEvent(new Event("delight-clipboard-copied"));
}

export async function copyTextWithFeedback(text: string) {
  await navigator.clipboard.writeText(text);
  announceClipboardCopy();
}
