const post = (message) => window.chrome.webview.postMessage(message);
const state = { major: 1, minor: 0, patch: 0, running: false };
const preview = document.querySelector("#version-preview");
const modal = document.querySelector("#modal");
const modalCard = modal.querySelector(".modal");
const updateVersion = () => {
  preview.textContent = `v${state.major}.${state.minor}.${state.patch}`;
  document.querySelectorAll(".stepper").forEach((stepper) => {
    stepper.querySelector("strong").textContent = state[stepper.dataset.part];
  });
};
const sendVersion = () => post({ action: "version", major: state.major, minor: state.minor, patch: state.patch });

document.querySelector("#drag-region").addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  post({ action: "drag" });
});
document.querySelector("#drag-region").addEventListener("dblclick", (event) => {
  if (!event.target.closest("button")) post({ action: "maximize" });
});
document.querySelectorAll("[data-window]").forEach((button) => button.addEventListener("click", () => post({ action: button.dataset.window })));
document.querySelectorAll(".stepper button").forEach((button) => button.addEventListener("click", () => {
  const part = button.closest(".stepper").dataset.part;
  state[part] = Math.max(0, Math.min(999, state[part] + Number(button.dataset.delta)));
  updateVersion(); sendVersion();
}));
document.querySelector("#next-patch").addEventListener("click", () => { state.patch = Math.min(999, state.patch + 1); updateVersion(); sendVersion(); });

const hideModal = () => { modal.hidden = true; modalCard.classList.remove("error"); };
document.querySelector("#modal-cancel").addEventListener("click", hideModal);
document.querySelector("#publish").addEventListener("click", () => {
  document.querySelector("#modal-eyebrow").textContent = "CONFIRM RELEASE";
  document.querySelector("#modal-title").textContent = `Publish Bloom Client v${state.major}.${state.minor}.${state.patch}?`;
  document.querySelector("#modal-message").textContent = `Bloom will validate the project, commit and push the version bump, create the tag, run the signed Windows build, and ${document.querySelector("#auto-publish").checked ? "publish the completed release" : "leave the completed release as a draft"}.`;
  document.querySelector("#modal-confirm").hidden = false;
  document.querySelector("#modal-cancel").textContent = "Cancel";
  modal.hidden = false;
});
document.querySelector("#modal-confirm").addEventListener("click", () => {
  hideModal();
  post({ action: "publish", major: state.major, minor: state.minor, patch: state.patch, notes: document.querySelector("#release-notes").value, autoPublish: document.querySelector("#auto-publish").checked });
});

window.bloom = {
  setState(next) { Object.assign(state, next); updateVersion(); this.setBusy(Boolean(next.running)); },
  setBusy(value) {
    state.running = value;
    document.querySelectorAll(".workspace button, footer button, textarea, input").forEach((control) => control.disabled = value);
    document.querySelector("#publish b").textContent = value ? "Building Bloom Client…" : "Build and publish release";
    document.querySelector("#console-state").textContent = value ? "RUNNING" : "READY";
  },
  clearTerminal() { document.querySelector("#terminal").replaceChildren(); },
  appendLog(message, color) {
    const terminal = document.querySelector("#terminal");
    const line = document.createElement("span"); line.textContent = message; line.style.color = color;
    terminal.append(line); terminal.scrollTop = terminal.scrollHeight;
  },
  setStatus(message, tone = "muted") {
    document.querySelector("#status-text").textContent = message;
    document.querySelector(".status").className = `status ${tone}`;
  },
  showResult(title, message, error) {
    document.querySelector("#modal-eyebrow").textContent = error ? "RELEASE STOPPED" : "BLOOM RELEASE";
    document.querySelector("#modal-title").textContent = title;
    document.querySelector("#modal-message").textContent = message;
    document.querySelector("#modal-confirm").hidden = true;
    document.querySelector("#modal-cancel").textContent = "Close";
    modalCard.classList.toggle("error", error); modal.hidden = false;
  }
};
