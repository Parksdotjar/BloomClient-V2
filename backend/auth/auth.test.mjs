import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBloomAuth } from "./auth.mjs";

test("account storage migrates and providers require complete credentials", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-auth-test-"));
  const runtime = await createBloomAuth({
    env: {
      BLOOM_SITE_URL: "http://127.0.0.1:4176",
      BLOOM_AUTH_DATA_DIR: directory,
      BLOOM_AUTH_SECRET: "test-only-secret-with-at-least-thirty-two-characters",
      BLOOM_GOOGLE_CLIENT_ID: "incomplete-is-disabled",
    },
  });
  context.after(() => {
    runtime.database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(runtime.configuredProviders, []);
  const tables = runtime.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name);
  for (const table of ["user", "session", "account", "verification"]) assert.ok(tables.includes(table));
  const deviceSessions = await runtime.auth.handler(new Request("http://127.0.0.1:4176/api/auth/multi-session/list-device-sessions"));
  assert.equal(deviceSessions.status, 200);
  assert.deepEqual(await deviceSessions.json(), []);
});

test("production account service refuses a missing secret", async () => {
  await assert.rejects(
    createBloomAuth({ env: { BLOOM_SITE_URL: "https://bloomclient.org", BLOOM_AUTH_DATA_DIR: os.tmpdir() } }),
    /BLOOM_AUTH_SECRET/,
  );
});

test("Google sign-in starts Authorization Code with PKCE", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-auth-oauth-test-"));
  const runtime = await createBloomAuth({
    env: {
      BLOOM_SITE_URL: "http://127.0.0.1:4176",
      BLOOM_AUTH_DATA_DIR: directory,
      BLOOM_AUTH_SECRET: "test-only-secret-with-at-least-thirty-two-characters",
      BLOOM_GOOGLE_CLIENT_ID: "google-client-id",
      BLOOM_GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
  });
  context.after(() => {
    runtime.database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const response = await runtime.auth.handler(new Request("http://127.0.0.1:4176/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:4176" },
    body: JSON.stringify({ provider: "google", callbackURL: "/dashboard/" }),
  }));
  const body = await response.json();
  const authorization = new URL(body.url);
  assert.equal(response.status, 200);
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorization.searchParams.get("code_challenge"));
  assert.equal(authorization.searchParams.get("redirect_uri"), "http://127.0.0.1:4176/api/auth/callback/google");
});
