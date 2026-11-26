import { createHash, randomBytes, randomUUID } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const linkPattern = /^\/invite\/([A-Za-z0-9_-]{43})$/;
const invitePath = "/share/invite";
const accessPattern = /^\/v1\/workspace-packs\/([23456789A-HJ-NP-Z]{8})\/access$/;
const invitationRoute = "/v1/workspace-invites";
const hour = 3_600_000;
const digest = token => createHash("sha256").update(token).digest("hex");
const escape = value => String(value).replace(/[&<>"']/g, char => (
  {"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"}[char]
));
const inviteStyle = `body{color-scheme:dark;background:#0d0d0d;color:#f5f5f5;font:16px system-ui;margin:0}
main{max-width:38rem;margin:12vh auto;padding:0 24px}p{color:#b5b5b5}a{display:inline-block;margin-top:10px;padding:10px 16px;border-radius:7px;background:#90adf0;color:#101827;font-weight:650;text-decoration:none}
[hidden]{display:none}`;
const inviteScript = `const launch = document.getElementById("open-in-delight");
const invalid = document.getElementById("invalid-invite");
function showInvite() {
  const token = location.hash.slice(1);
  const valid = ${tokenPattern}.test(token);
  launch.hidden = !valid;
  invalid.hidden = valid;
  if (valid) launch.href = "delight://invite/" + token;
  else launch.removeAttribute("href");
}
addEventListener("hashchange", showInvite);
showInvite();`;
const inviteScriptHash = createHash("sha256").update(inviteScript).digest("base64");

function invitePage(content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Pack invitation · Delight Client</title><style>${inviteStyle}</style></head><body><main>${content}</main></body></html>`;
}

export function workspaceAccess({database, authenticate, base, byCode, now, reject, send, read}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, code TEXT NOT NULL REFERENCES workspace_packs(code),
      role TEXT NOT NULL CHECK(role IN ('view','edit')), created_at INTEGER NOT NULL, expires_at INTEGER,
      max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS workspace_invites_pack ON workspace_invites(code);
    CREATE TABLE IF NOT EXISTS workspace_collaborators (
      code TEXT NOT NULL REFERENCES workspace_packs(code), account TEXT NOT NULL, id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('view','edit')), publish INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(code,account)
    );
    CREATE TABLE IF NOT EXISTS workspace_removed_collaborators (
      code TEXT NOT NULL REFERENCES workspace_packs(code), account TEXT NOT NULL, removed_at INTEGER NOT NULL,
      PRIMARY KEY(code,account)
    );
    CREATE TABLE IF NOT EXISTS workspace_public_sharing (
      code TEXT PRIMARY KEY REFERENCES workspace_packs(code),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
    );
  `);
  const original = database.prepare("SELECT owner_id,creator FROM workspace_packs WHERE code=?");
  const member = database.prepare("SELECT * FROM workspace_collaborators WHERE code=? AND account=?");
  const roleFor = (pack, account) => {
    if (original.get(pack.code).owner_id === account) return {role:"owner", canPublish:true, canRequire:true};
    const grant = member.get(pack.code, account);
    return {role:grant?.role ?? null, canPublish:grant?.role === "edit" && grant.publish === 1, canRequire:false};
  };
  const listLinks = database.prepare(`SELECT id, role, created_at AS createdAt, expires_at AS expiresAt,
    max_uses AS maxUses, uses, revoked_at AS revokedAt FROM workspace_invites WHERE code=? ORDER BY created_at DESC LIMIT 100`);
  const listPeople = database.prepare("SELECT id, name, role, publish AS canPublish FROM workspace_collaborators WHERE code=? ORDER BY name,id");
  const create = database.prepare("INSERT INTO workspace_invites(id,token_hash,code,role,created_at,expires_at,max_uses) VALUES(?,?,?,?,?,?,?)");
  const findLink = database.prepare("SELECT * FROM workspace_invites WHERE token_hash=?");
  const consume = database.prepare("UPDATE workspace_invites SET uses=uses+1 WHERE id=?");
  const join = database.prepare(`INSERT INTO workspace_collaborators(code,account,id,name,role) VALUES(?,?,?,?,?)
    ON CONFLICT(code,account) DO UPDATE SET role=excluded.role, name=excluded.name`);
  const revoke = database.prepare("UPDATE workspace_invites SET revoked_at=? WHERE code=? AND id=? AND revoked_at IS NULL");
  const publish = database.prepare("UPDATE workspace_collaborators SET publish=? WHERE code=? AND id=? AND role='edit'");
  const remove = database.prepare("DELETE FROM workspace_collaborators WHERE code=? AND id=?");
  const removed = database.prepare("SELECT removed_at FROM workspace_removed_collaborators WHERE code=? AND account=?");
  const markRemoved = database.prepare(`INSERT INTO workspace_removed_collaborators VALUES(?,?,?)
    ON CONFLICT(code,account) DO UPDATE SET removed_at=excluded.removed_at`);
  const sharingState = database.prepare("SELECT enabled FROM workspace_public_sharing WHERE code=?");
  const setSharingState = database.prepare(`INSERT INTO workspace_public_sharing(code,enabled) VALUES(?,?)
    ON CONFLICT(code) DO UPDATE SET enabled=excluded.enabled`);
  const sharingEnabled = code => sharingState.get(code)?.enabled !== 0;
  const accountFor = database.prepare("SELECT account FROM workspace_collaborators WHERE code=? AND id=?");
  const activeLinks = database.prepare(`SELECT COUNT(*) AS total FROM workspace_invites WHERE code=? AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses)`);
  const trimLinks = database.prepare(`DELETE FROM workspace_invites WHERE code=? AND id NOT IN
    (SELECT id FROM workspace_invites WHERE code=? ORDER BY created_at DESC, rowid DESC LIMIT 100)
    AND (revoked_at IS NOT NULL OR expires_at<=? OR uses>=max_uses)`);
  const accountName = user => String(user.username || "Delight player").slice(0, 80);

  function transaction(action) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  function available(invite) {
    if (!invite || invite.revoked_at !== null || (invite.expires_at !== null && invite.expires_at <= now())) {
      reject(404, "invite_unavailable");
    }
    if (!sharingEnabled(invite.code)) reject(403, "sharing_paused");
  }
  function preview(invite, pack) {
    return {name:JSON.parse(pack.manifest_json).name, creator:original.get(pack.code).creator, role:invite.role,
      playerUrl:base + "/share/pack/" + pack.code};
  }

  async function handle(request, response, pathname) {
    const access = accessPattern.exec(pathname);
    const landing = linkPattern.exec(pathname);
    if (!access && !landing && pathname !== invitationRoute && pathname !== invitePath) return false;
    if (pathname === invitePath) {
      if (request.method !== "GET") reject(405, "method_not_allowed");
      // A URL fragment stays in the browser. The launcher previews and accepts by POST.
      return send(response, 200, invitePage(`<h1>Pack invitation</h1>
<a id="open-in-delight" hidden>Open in Delight</a>
<p id="invalid-invite" hidden>Open the complete invitation link.</p>
<noscript><p>Paste the complete invitation link in Delight.</p></noscript>
<script>${inviteScript}</script>`), true, inviteScriptHash);
    }
    if (landing) {
      if (request.method !== "GET") reject(405, "method_not_allowed");
      const invite = findLink.get(digest(landing[1]));
      available(invite);
      if (invite.max_uses !== null && invite.uses >= invite.max_uses) reject(404, "invite_exhausted");
      const info = preview(invite, byCode.get(invite.code));
      return send(response, 200, invitePage(`<h1>${escape(info.name)}</h1><p>${escape(info.creator)} invited you to ${info.role} this pack.</p>
<a href="delight://invite/${landing[1]}">Open in Delight</a>`), true);
    }
    if (request.method !== "POST" && !(access && request.method === "GET")) reject(405, "method_not_allowed");
    const body = request.method === "POST" ? await read(request) : null;
    if (request.method === "POST" && (!body || typeof body !== "object")) reject(400, "invalid_access_request");
    if (!access && body.action === "preview") {
      if (typeof body.token !== "string" || !tokenPattern.test(body.token)) reject(404, "invite_unavailable");
      const invite = findLink.get(digest(body.token));
      available(invite);
      return send(response, 200, preview(invite, byCode.get(invite.code)));
    }
    const user = await authenticate(request);
    if (!user?.id) reject(401, "not_authenticated");
    if (!access) {
      if (body.action !== "accept" || typeof body.token !== "string" || !tokenPattern.test(body.token)) reject(404, "invite_unavailable");
      const result = transaction(() => {
        const invite = findLink.get(digest(body.token));
        available(invite);
        const pack = byCode.get(invite.code);
        const removal = removed.get(invite.code, user.id);
        if (removal && invite.created_at <= removal.removed_at) reject(403, "invite_needs_replacement");
        const current = roleFor(pack, user.id);
        if (current.role === "owner" || current.role === "edit" || current.role === invite.role) {
          return {...preview(invite, pack), ...current};
        }
        if (invite.max_uses !== null && invite.uses >= invite.max_uses) reject(409, "invite_exhausted");
        if (!current.role && listPeople.all(invite.code).length >= 250) reject(409, "collaborator_limit");
        join.run(invite.code, user.id, randomUUID(), accountName(user), invite.role);
        consume.run(invite.id);
        return {...preview(invite, pack), ...roleFor(pack, user.id)};
      });
      return send(response, 200, result);
    }
    const code = access[1];
    const pack = byCode.get(code);
    if (!pack) reject(404, "pack_not_found");
    const permission = roleFor(pack, user.id);
    if (request.method === "GET") {
      return send(response, 200, permission.role !== "owner" ? permission : {
        ...permission, sharingEnabled:sharingEnabled(code), links:listLinks.all(code),
        people:listPeople.all(code).map(p => ({...p, canPublish:!!p.canPublish})),
      });
    }
    if (permission.role !== "owner") reject(403, "not_pack_owner");
    if (body.action === "setSharing") {
      if (typeof body.enabled !== "boolean") reject(400, "invalid_access_request");
      setSharingState.run(code, Number(body.enabled));
      return send(response, 200, {sharingEnabled:body.enabled});
    }
    if (body.action === "create") {
      const {role, expiresInHours, maxUses} = body;
      if (!["view","edit"].includes(role) || !(expiresInHours === null ||
          Number.isSafeInteger(expiresInHours) && expiresInHours >= 1 && expiresInHours <= 2160) ||
          !(maxUses === null || Number.isSafeInteger(maxUses) && maxUses >= 1 && maxUses <= 250)) reject(400, "invalid_invite_limits");
      const token = randomBytes(32).toString("base64url");
      const id = randomUUID();
      transaction(() => {
        if (!sharingEnabled(code)) reject(403, "sharing_paused");
        const createdAt = now();
        if (activeLinks.get(code, createdAt).total >= 50) reject(409, "invite_limit");
        create.run(id, digest(token), code, role, createdAt, expiresInHours === null ? null : createdAt + expiresInHours * hour, maxUses);
        trimLinks.run(code, code, createdAt);
      });
      return send(response, 201, {id, url:base + invitePath + "#" + token});
    }
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id)) reject(400, "invalid_access_request");
    if (body.action === "revoke") revoke.run(now(), code, body.id);
    else if (body.action === "publish" && typeof body.enabled === "boolean") {
      if (!publish.run(Number(body.enabled), code, body.id).changes) reject(404, "editor_not_found");
    } else if (body.action === "remove") transaction(() => {
      const person = accountFor.get(code, body.id);
      if (!person) return;
      markRemoved.run(code, person.account, now());
      remove.run(code, body.id);
    });
    else reject(400, "invalid_access_request");
    return send(response, 200, {});
  }
  return {handle, roleFor, sharingEnabled};
}
