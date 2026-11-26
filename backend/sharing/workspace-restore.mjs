import { createHash } from "node:crypto";

const route = /^\/v1\/workspace-packs\/([23456789A-HJ-NP-Z]{8})\/restore$/;

export function workspaceRestore({
  database, authenticate, byId, byCode, byRevision, roleFor, append, admit, now,
  reject, send, read, normalizeManifest, resolveManifest, plainText, uuidPattern, receipt,
}) {
  function reviewedRelease(code, owner, input, digest) {
    const head = byCode.get(code);
    if (!head) reject(404, "pack_not_found");
    if (roleFor(head, owner.id).role !== "owner") reject(403, "restore_forbidden");
    const saved = byId.get(owner.id, input.id);
    if (saved) {
      if (saved.request_hash !== digest) reject(409, "publication_changed");
      return {saved};
    }
    if (head.revision !== input.baseRevision) reject(409, "stale_base_revision");
    const source = byRevision.get(code, input.sourceRevision);
    if (!source) reject(404, "release_not_found");
    return {head, source};
  }

  return async function handle(request, response, pathname) {
    const match = route.exec(pathname);
    if (!match) return false;
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      reject(405, "method_not_allowed");
    }
    const code = match[1];
    const owner = await authenticate(request);
    if (!owner?.id) reject(401, "not_authenticated");
    const body = await read(request);
    if (!body || typeof body.publicationId !== "string" || !uuidPattern.test(body.publicationId) ||
        !Number.isSafeInteger(body.baseRevision) || body.baseRevision >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(body.sourceRevision) || body.sourceRevision < 1 || body.sourceRevision >= body.baseRevision ||
        typeof body.required !== "boolean") reject(400, "invalid_restore");
    if (body.termsVersion !== "1") reject(400, "sharing_terms_required");
    if (!plainText(body.releaseNote, 1000, true)) reject(400, "invalid_release_note");
    const releaseNote = body.releaseNote.trim();
    if (body.required && !releaseNote) reject(400, "required_update_needs_note");
    const input = {id:body.publicationId.toLowerCase(), baseRevision:body.baseRevision, sourceRevision:body.sourceRevision};
    const digest = createHash("sha256").update(JSON.stringify({
      action:"restore", code, ...input, releaseNote, required:body.required, termsVersion:body.termsVersion,
    })).digest("hex");
    const initial = reviewedRelease(code, owner, input, digest);
    if (initial.saved) return send(response, 200, receipt(initial.saved));

    admit(owner.id);
    // Recheck the historical pins with the providers. A restore never accepts
    // a replacement manifest from the caller.
    const manifest = await resolveManifest(normalizeManifest(JSON.parse(initial.source.manifest_json)));
    const current = await authenticate(request);
    if (!current || current.id !== owner.id) reject(401, "not_authenticated");

    database.exec("BEGIN IMMEDIATE");
    let value;
    let status;
    try {
      const latest = reviewedRelease(code, current, input, digest);
      if (latest.saved) {
        value = receipt(latest.saved);
        status = 200;
      } else {
        value = append(latest.head, body.required, [
          owner.id, input.id, digest, body.termsVersion, current.username || "Delight creator",
          releaseNote, JSON.stringify(manifest), now(),
        ]);
        status = 201;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return send(response, status, value);
  };
}
