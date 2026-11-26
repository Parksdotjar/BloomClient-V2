import { readFileSync } from "node:fs";

const icon = "data:image/png;base64," + readFileSync(new URL("./delight-icon.png", import.meta.url)).toString("base64");
const categories = [
  ["mods", "Mods", "mod"],
  ["resourcepacks", "Resource packs", "resourcepack"],
  ["shaderpacks", "Shaders", "shader"],
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fileRow(file, projectType) {
  const status = file.enabled ? "Enabled" : "Disabled";
  const title = escapeHtml(file.fileName);
  let source = "Provided separately by Delight";
  if (file.source === "modrinth") {
    const project = encodeURIComponent(file.projectId);
    const version = encodeURIComponent(file.versionId);
    const url = "https://modrinth.com/" + projectType + "/" + project + "/version/" + version;
    source = '<a href="' + escapeHtml(url) + '" aria-label="View the Modrinth release for ' + title + '">Modrinth release <span aria-hidden="true">↗</span></a>';
  }
  return `<li><div class="file-info"><strong>${title}</strong><small>${source}</small></div>
    <span class="status" data-enabled="${file.enabled}" role="img" aria-label="${status}" title="${status}"></span></li>`;
}

function fileGroup(files, category, label, projectType) {
  const entries = files.filter(file => file.category === category);
  if (!entries.length) return "";
  return `<section class="files" aria-labelledby="${category}">
    <h2 id="${category}">${label}</h2><div class="columns" aria-hidden="true"><span>Name</span><span>Status</span></div>
    <ul>${entries.map(file => fileRow(file, projectType)).join("")}</ul></section>`;
}

const styles = `
:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; color: #f3f3f3; background: #0c0c0c; }
* { box-sizing: border-box; }
body { margin: 0; }
.frame { background: #161616; border-bottom: 1px solid #2d2d2d; }
.bar, main { max-width: 920px; margin: 0 auto; padding-inline: clamp(18px, 5vw, 54px); }
.bar { height: 52px; display: flex; align-items: center; }
a { color: #adc9ff; text-underline-offset: 3px; }
a:hover { color: #d2e2ff; }
a:focus-visible { outline: 2px solid #97b6fa; outline-offset: 3px; border-radius: 3px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: inherit; font-weight: 650; text-decoration: none; }
.brand img { width: 25px; height: 25px; object-fit: contain; }
main { padding-block: clamp(30px, 6vw, 66px) 60px; }
h1, h2, p, dl, dd, ul { margin: 0; }
h1 { font-size: clamp(30px, 5vw, 44px); letter-spacing: -.035em; line-height: 1.1; overflow-wrap: anywhere; }
h2 { font-size: 18px; line-height: 1.35; }
.byline, dt, .columns, .file-info small { color: #b3b3b3; }
.byline { margin-top: 9px; overflow-wrap: anywhere; }
.open-pack { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 22px; }
.open-pack a { padding: 10px 16px; border-radius: 7px; color: #11151e; background: #97b6fa; font-weight: 650; text-decoration: none; }
.open-pack a:hover { background: #adc9ff; }
.open-pack p { color: #b3b3b3; font-size: 13px; }
.facts { display: flex; flex-wrap: wrap; gap: 16px 38px; margin-top: 26px; padding-bottom: 22px; border-bottom: 1px solid #303030; }
dt, .columns, .file-info small { font-size: 13px; }
dd { margin-top: 3px; font-size: 15px; overflow-wrap: anywhere; }
.note, .files, .omissions { margin-top: 28px; }
.note p, .omissions p { margin-top: 8px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.columns, .files li { display: grid; grid-template-columns: minmax(0,1fr) 50px; align-items: center; padding-inline: 12px; }
.columns { margin-block: 14px 6px; }
.columns span:last-child, .status { justify-self: center; }
ul { list-style: none; padding: 0; }
.files li { background: #171717; border-radius: 7px; min-height: 56px; padding-block: 8px; margin-top: 3px; }
.file-info { min-width: 0; display: grid; gap: 3px; overflow-wrap: anywhere; }
.file-info strong { font-size: 14px; font-weight: 650; }
.file-info small a { text-decoration: none; }
.file-info small a:hover { text-decoration: underline; }
.status { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #aaa; }
.status[data-enabled="true"] { border: 0; background: #5dd773; box-shadow: inset 0 1px 1px #a4f4ad, inset 0 -1px 2px #206f2e; }
.empty { margin-top: 26px; color: #b3b3b3; }
@media (forced-colors: active) { .status[data-enabled="true"] { background: CanvasText; forced-color-adjust: none; } }
`;

function renderPage(title, content) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · Delight Client</title><link rel="icon" href="${icon}"><style>${styles}</style></head>
<body><header class="frame"><div class="bar"><a class="brand" href="https://bloomclient.org/"><img src="${icon}" alt="">Delight Client</a></div></header>
<main>${content}</main></body></html>`;
}

export function renderWorkspaceSharingPaused() {
  return renderPage("Sharing is paused", '<h1>Sharing is paused</h1><p class="byline">The pack owner paused this player link.</p>');
}

export function renderWorkspacePreview({ code, manifest, revision, creator, releaseNote, createdAt, required, minimumPlayableRevision }) {
  const { name, minecraftVersion, loaderVersion, excludedFolders, files } = manifest;
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(createdAt));
  const policy = required ? "Required" : minimumPlayableRevision > 1 ? "Optional from version " + minimumPlayableRevision : "Optional";
  return renderPage(name, `<h1>${escapeHtml(name)}</h1><p class="byline">Shared by ${escapeHtml(creator)}</p>
<div class="open-pack"><a href="delight://pack/${encodeURIComponent(code)}">Open in Delight</a>
<p>Or paste this page’s address in Delight under File → Open player link.</p></div>
<dl class="facts"><div><dt>Release</dt><dd>Version ${escapeHtml(revision)}</dd></div>
${revision > 1 ? '<div><dt>Update</dt><dd>' + escapeHtml(policy) + '</dd></div>' : ''}
<div><dt>Minecraft</dt><dd>${escapeHtml(minecraftVersion)}</dd></div>
<div><dt>Loader</dt><dd>Fabric ${escapeHtml(loaderVersion)}</dd></div>
<div><dt>Published (UTC)</dt><dd><time datetime="${escapeHtml(createdAt)}">${date}</time></dd></div></dl>
${releaseNote ? '<section class="note"><h2>Release note</h2><p>' + escapeHtml(releaseNote) + '</p></section>' : ""}
${categories.map(args => fileGroup(files, ...args)).join("")}
${files.length ? "" : '<p class="empty">This release contains no additional files.</p>'}
${excludedFolders.length ? '<section class="omissions"><h2>Excluded folders</h2><p>' + excludedFolders.map(escapeHtml).join(", ") + '</p></section>' : ""}`);
}
