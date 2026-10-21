// Apply before React mounts, including onboarding and portaled dialogs.
const preventBrowserMenu = (event: Event) => {
  // Keep propagation intact so Bloom's own context menus still work.
  event.preventDefault();
};

const preventInspectorShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  const inspector = ["i", "j", "c"].includes(key);
  if (
    key === "f12" ||
    (event.ctrlKey && event.shiftKey && inspector) ||
    (event.metaKey && event.altKey && inspector) ||
    (event.ctrlKey && key === "u") ||
    (event.metaKey && event.altKey && key === "u")
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
};

window.addEventListener("contextmenu", preventBrowserMenu, true);
window.addEventListener("keydown", preventInspectorShortcut, true);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("contextmenu", preventBrowserMenu, true);
    window.removeEventListener("keydown", preventInspectorShortcut, true);
  });
}
