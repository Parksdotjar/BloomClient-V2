import { createHash, randomUUID } from "node:crypto";

const route = /^\/v1\/workspace-packs\/([23456789A-HJ-NP-Z]{8})\/drafts(?:\/([0-9a-f-]{36}))?$/;
const authorStates = new Set(["saved", "returned"]);
const packDraftLimit = 100;
const editorDraftLimit = 10;
const avatarHosts = new Set(["avatars.githubusercontent.com",
  "lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com"]);

function providerAvatarUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !avatarHosts.has(url.hostname) || url.port || url.username || url.password ||
        url.pathname === "/") return null;
    if (url.hostname === "avatars.githubusercontent.com" && !/^\/u\/[0-9]+$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function linkedMinecraftAvatarUrl(value) {
  if (typeof value !== "string" ||
      !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(value)) return null;
  const uuid = value.replaceAll("-", "").toLowerCase();
  return `https://mc-heads.net/avatar/${uuid}/96`;
}

export function workspaceDrafts({ database, authenticate, authorProfile, byCode, byRevision, roleFor, append, admit,
  now, reject, send, read, normalizeManifest, resolveManifest, plainText, uuidPattern, receipt }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_pack_drafts (
      code TEXT NOT NULL REFERENCES workspace_packs(code),
      id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      version INTEGER NOT NULL,
      note TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('saved', 'submitted', 'returned', 'published', 'discarded')),
      review_note TEXT NOT NULL DEFAULT '',
      submitted_at INTEGER,
      published_revision INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(code, id)
    );
    CREATE INDEX IF NOT EXISTS workspace_drafts_state ON workspace_pack_drafts(code, state, updated_at);
    CREATE INDEX IF NOT EXISTS workspace_drafts_author ON workspace_pack_drafts(code, author_id, state, updated_at);
  `);
  const find = database.prepare("SELECT * FROM workspace_pack_drafts WHERE code=? AND id=?");
  const columns = `id, author_id, author, base_revision, version, note, state, review_note,
    submitted_at, published_revision, updated_at`;
  const order = "ORDER BY updated_at DESC, id";
  const ownerPending = database.prepare(`SELECT ${columns} FROM workspace_pack_drafts WHERE code=? AND state='submitted' ${order}`);
  const ownerPublished = database.prepare(`SELECT ${columns} FROM workspace_pack_drafts WHERE code=? AND state='published' ${order} LIMIT 20`);
  const editorPending = database.prepare(`SELECT ${columns} FROM workspace_pack_drafts
    WHERE code=? AND author_id=? AND state IN ('saved', 'submitted', 'returned') ${order}`);
  const editorPublished = database.prepare(`SELECT ${columns} FROM workspace_pack_drafts WHERE code=? AND author_id=? AND state='published' ${order} LIMIT 20`);
  const awaitingReview = database.prepare("SELECT COUNT(*) AS count FROM workspace_pack_drafts WHERE code=? AND state='submitted'");
  const authorOpen = database.prepare(`SELECT COUNT(*) AS count FROM workspace_pack_drafts
    WHERE code=? AND author_id=? AND state IN ('saved', 'submitted', 'returned')`);
  const create = database.prepare(`INSERT INTO workspace_pack_drafts
    (code,id,author_id,author,base_revision,version,note,manifest_json,state,updated_at)
    VALUES(?,?,?,?,?,1,?,?,'saved',?)`);
  const save = database.prepare(`UPDATE workspace_pack_drafts SET
    base_revision=?, note=?, manifest_json=?, state='saved', version=version+1, updated_at=? WHERE code=? AND id=?`);
  const submit = database.prepare(`UPDATE workspace_pack_drafts SET
    state='submitted', submitted_at=?, version=version+1, updated_at=? WHERE code=? AND id=?`);
  const review = database.prepare(`UPDATE workspace_pack_drafts SET
    state=?, review_note=?, version=version+1, updated_at=? WHERE code=? AND id=?`);
  const markPublished = database.prepare(`UPDATE workspace_pack_drafts SET
    state='published', published_revision=?, version=version+1, updated_at=? WHERE code=? AND id=?`);
  const discard = database.prepare(`UPDATE workspace_pack_drafts SET
    state='discarded', manifest_json='{}', note='', review_note='', version=version+1, updated_at=? WHERE code=? AND id=?`);

  function transaction(run) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const value = run();
      database.exec("COMMIT");
      return value;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function context(code, user) {
    const head = byCode.get(code);
    if (!head) reject(404, "pack_not_found");
    const role = roleFor(head, user.id).role;
    if (role !== "owner" && role !== "edit") reject(403, "drafts_forbidden");
    return {head, role};
  }

  function summary(row, head, role, detail = false) {
    const timestamp = value => new Date(value).toISOString();
    const profile = authorProfile(row.author_id);
    const displayName = plainText(profile?.displayName, 80) ? profile.displayName.trim() : "";
    const avatarUrl = providerAvatarUrl(profile?.avatarUrl) ?? linkedMinecraftAvatarUrl(profile?.minecraftUuid);
    return {
      id: row.id, author: displayName || row.author, authorAvatarUrl: avatarUrl,
      baseRevision: row.base_revision, version: row.version, note: row.note,
      state: row.state, reviewNote: row.review_note, updatedAt: timestamp(row.updated_at),
      submittedAt: row.submitted_at === null ? null : timestamp(row.submitted_at),
      publishedRevision: row.published_revision,
      canReview: role === "owner" && row.state === "submitted" && roleFor(head, row.author_id).role === "edit",
      ...(detail && {manifest: JSON.parse(row.manifest_json)}),
    };
  }

  function visibleDraft(code, id, role, user) {
    if (!uuidPattern.test(id)) reject(404, "draft_not_found");
    const row = find.get(code, id);
    const visible = row && (role === "owner"
      ? row.state === "submitted" || row.state === "published"
      : row.author_id === user.id && row.state !== "discarded");
    if (!visible) reject(404, "draft_not_found");
    return row;
  }

  function text(value, required = false) {
    if (!plainText(value, 1000, true) || (required && !value.trim())) reject(400, "invalid_draft_note");
    return value.trim();
  }

  function saveDraft(code, user, body) {
    if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1) reject(400, "invalid_draft");
    const id = body.id ?? randomUUID();
    const note = text(body.note);
    const manifest = JSON.stringify(normalizeManifest(body.manifest));
    return transaction(() => {
      const {head, role} = context(code, user);
      if (role !== "edit") reject(403, "drafts_forbidden");
      if (!byRevision.get(code, body.baseRevision)) reject(404, "release_not_found");
      const current = find.get(code, id);
      if (!current) {
        if (body.version != null) reject(404, "draft_not_found");
        if (authorOpen.get(code, user.id).count >= editorDraftLimit) {
          reject(409, "draft_limit");
        }
        const author = String(user.username || "Delight editor").slice(0, 80);
        create.run(code, id, user.id, author, body.baseRevision, note, manifest, now());
      } else {
        if (current.author_id !== user.id) reject(404, "draft_not_found");
        const requestedVersion = body.version ?? 0;
        if (current.state === "saved" && current.version === requestedVersion + 1 &&
            current.base_revision === body.baseRevision && current.note === note && current.manifest_json === manifest) {
          return summary(current, head, role, true);
        }
        if (!authorStates.has(current.state) || current.version !== body.version) reject(409, "draft_changed");
        save.run(body.baseRevision, note, manifest, now(), code, id);
      }
      return summary(find.get(code, id), head, role, true);
    });
  }

  function changeDraft(code, user, body) {
    return transaction(() => {
      const {head, role} = context(code, user);
      const ownerAction = body.action === "return";
      if (role !== (ownerAction ? "owner" : "edit")) reject(403, "drafts_forbidden");
      const found = find.get(code, body.id);
      if (body.action === "discard" && found?.state === "discarded" && found.author_id === user.id) return {};
      const reviewNote = ownerAction ? text(body.reviewNote, true) : "";
      if (ownerAction && found?.state === "returned" && found.version === body.version + 1 && found.review_note === reviewNote) {
        return summary(found, head, role, true);
      }
      const row = visibleDraft(code, body.id, role, user);
      if (row.version !== body.version) {
        const repeatedSubmit = body.action === "submit" && row.state === "submitted";
        const repeatedWithdraw = body.action === "withdraw" && row.state === "saved";
        if (row.version === body.version + 1 && (repeatedSubmit || repeatedWithdraw)) {
          return summary(row, head, role, true);
        }
        reject(409, "draft_changed");
      }
      switch (body.action) {
        case "submit":
          if (!authorStates.has(row.state)) reject(409, "draft_changed");
          if (row.base_revision !== head.revision) reject(409, "stale_base_revision");
          if (awaitingReview.get(code).count >= packDraftLimit) reject(409, "draft_limit");
          const time = now();
          submit.run(time, time, code, row.id);
          break;
        case "withdraw":
          if (row.state !== "submitted") reject(409, "draft_changed");
          review.run("saved", row.review_note, now(), code, row.id);
          break;
        case "return":
          if (row.state !== "submitted") reject(409, "draft_changed");
          review.run("returned", reviewNote, now(), code, row.id);
          break;
        case "discard":
          if (!authorStates.has(row.state)) reject(409, "draft_changed");
          // Keep the identity occupied so an earlier approval can never apply to
          // a different submission created with the same client-generated ID.
          discard.run(now(), code, row.id);
          return {};
      }
      return summary(find.get(code, row.id), head, role, true);
    });
  }

  function publishSelection(code, owner, body) {
    const {head, role} = context(code, owner);
    if (role !== "owner") reject(403, "drafts_forbidden");
    const row = visibleDraft(code, body.id, role, owner);
    const note = body.releaseNote === undefined ? row.note : text(body.releaseNote);
    if (body.required && !note) reject(400, "required_update_needs_note");
    if (row.state === "published" && row.version === body.version + 1) {
      const saved = byRevision.get(code, row.published_revision);
      if (!saved || Boolean(saved.required) !== body.required || saved.release_note !== note) reject(409, "draft_changed");
      return {published: receipt(saved)};
    }
    if (row.state !== "submitted" || row.version !== body.version) reject(409, "draft_changed");
    if (roleFor(head, row.author_id).role !== "edit") reject(403, "draft_author_removed");
    if (row.base_revision !== head.revision) reject(409, "stale_base_revision");
    return {head, row, note};
  }

  async function publishDraft(request, code, owner, body) {
    if (typeof body.required !== "boolean") reject(400, "invalid_update_policy");
    if (body.termsVersion !== "1") reject(400, "sharing_terms_required");
    const selection = publishSelection(code, owner, body);
    if (selection.published) return {status: 200, value: selection.published};
    admit(owner.id);
    const manifest = await resolveManifest(JSON.parse(selection.row.manifest_json));
    const current = await authenticate(request);
    if (!current || current.id !== owner.id) reject(401, "not_authenticated");
    return transaction(() => {
      // Authorization, the exact submitted snapshot, and the release pointer are
      // checked again after verification, inside the same transaction as the append.
      const next = publishSelection(code, current, body);
      if (next.published) return {status: 200, value: next.published};
      const digest = createHash("sha256").update(JSON.stringify({draft: next.row.id, version: next.row.version,
        base: next.row.base_revision, note: next.note, required: body.required, manifest})).digest("hex");
      const created = append(next.head, body.required, [
        current.id, randomUUID(), digest, body.termsVersion, current.username || "Delight creator",
        next.note, JSON.stringify(manifest), now(),
      ]);
      markPublished.run(created.revision, now(), code, next.row.id);
      return {status: 201, value: created};
    });
  }

  return async function handle(request, response, pathname) {
    const match = route.exec(pathname);
    if (!match) return false;
    const [, code, id] = match;
    if (request.method !== "GET" && (id || request.method !== "POST")) reject(405, "method_not_allowed");
    const body = request.method === "POST" ? await read(request) : null;
    const user = await authenticate(request);
    if (!user?.id) reject(401, "not_authenticated");
    const {head, role} = context(code, user);
    if (request.method === "GET") {
      if (id) return send(response, 200, summary(visibleDraft(code, id, role, user), head, role, true));
      const rows = role === "owner"
        ? [...ownerPending.all(code), ...ownerPublished.all(code)]
        : [...editorPending.all(code, user.id), ...editorPublished.all(code, user.id)];
      return send(response, 200, {role, headRevision: head.revision, ownerName: byRevision.get(code, 1).creator,
        drafts: rows.map(row => summary(row, head, role))});
    }
    if (!body || !["save", "submit", "withdraw", "return", "discard", "publish"].includes(body.action) ||
        (body.id != null && (typeof body.id !== "string" || !uuidPattern.test(body.id))) ||
        (body.version != null && (!Number.isSafeInteger(body.version) || body.version < 1))) reject(400, "invalid_draft");
    if (body.action !== "save" && (body.id == null || body.version == null)) reject(400, "invalid_draft");
    if (body.id) body.id = body.id.toLowerCase();
    if (body.action === "save") return send(response, 200, saveDraft(code, user, body));
    if (body.action === "publish") {
      const {status, value} = await publishDraft(request, code, user, body);
      return send(response, status, value);
    }
    return send(response, 200, changeDraft(code, user, body));
  };
}
