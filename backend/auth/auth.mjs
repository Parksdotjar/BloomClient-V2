import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import { multiSession } from "better-auth/plugins/multi-session";

const DEFAULT_SITE_URL = "http://127.0.0.1:4176";

const cleanOrigin = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BLOOM_SITE_URL must use HTTP or HTTPS');
  return url.origin;
};

const providerConfiguration = (env) => {
  const providers = {};
  if (env.BLOOM_GOOGLE_CLIENT_ID && env.BLOOM_GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.BLOOM_GOOGLE_CLIENT_ID,
      clientSecret: env.BLOOM_GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    };
  }
  if (env.BLOOM_GITHUB_CLIENT_ID && env.BLOOM_GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.BLOOM_GITHUB_CLIENT_ID,
      clientSecret: env.BLOOM_GITHUB_CLIENT_SECRET,
      prompt: "select_account",
    };
  }
  return providers;
};

export async function createBloomAuth({ env = process.env } = {}) {
  const siteOrigin = cleanOrigin(env.BLOOM_SITE_URL || DEFAULT_SITE_URL);
  const production = siteOrigin.startsWith("https://");
  const secret = env.BLOOM_AUTH_SECRET || (production ? "" : "bloom-local-development-secret-change-before-production");
  if (secret.length < 32) throw new Error("BLOOM_AUTH_SECRET must contain at least 32 characters");

  const dataDirectory = path.resolve(env.BLOOM_AUTH_DATA_DIR || path.join(process.cwd(), ".bloom-auth"));
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path.join(dataDirectory, "accounts.sqlite"));
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const socialProviders = providerConfiguration(env);

  const auth = betterAuth({
    appName: "Bloom Client",
    baseURL: siteOrigin,
    basePath: "/api/auth",
    secret,
    database,
    trustedOrigins: [siteOrigin],
    emailAndPassword: { enabled: false },
    socialProviders,
    plugins: [multiSession({ maximumSessions: 5 })],
    account: {
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    rateLimit: {
      enabled: production,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/link-social": { window: 60, max: 6 },
      },
    },
    advanced: {
      cookiePrefix: "bloom",
      useSecureCookies: production,
      ipAddress: production ? { ipAddressHeaders: ["cf-connecting-ip"] } : { disableIpTracking: true },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
      },
      database: { joins: true, validateSchema: false },
    },
  });

  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();

  return {
    auth,
    database,
    siteOrigin,
    configuredProviders: Object.keys(socialProviders),
  };
}

const sendJson = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(payload);
};

const nodeRequestToFetch = (request, origin) => {
  const method = request.method || "GET";
  return new Request(new URL(request.url || "/", origin), {
    method,
    headers: fromNodeHeaders(request.headers),
    body: method === "GET" || method === "HEAD" ? undefined : request,
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
  });
};

const writeFetchResponse = async (response, result) => {
  response.statusCode = result.status;
  for (const [name, value] of result.headers) {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, value);
  }
  const cookies = result.headers.getSetCookie?.() || [];
  if (cookies.length) response.setHeader("set-cookie", cookies);
  response.end(Buffer.from(await result.arrayBuffer()));
};

export function createAccountApi({ auth, configuredProviders, siteOrigin }) {
  const sessionFor = (request) => auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

  return {
    async handle(request, response, pathname) {
      if (pathname.startsWith("/api/auth/")) {
        await writeFetchResponse(response, await auth.handler(nodeRequestToFetch(request, siteOrigin)));
        return true;
      }

      if (pathname === "/v1/account/config" && request.method === "GET") {
        sendJson(response, 200, { providers: configuredProviders });
        return true;
      }

      if (pathname === "/v1/account/me" && request.method === "GET") {
        const session = await sessionFor(request);
        if (!session) {
          sendJson(response, 401, { error: "not_authenticated" });
          return true;
        }
        const accounts = await auth.api.listUserAccounts({ headers: fromNodeHeaders(request.headers) });
        sendJson(response, 200, {
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image || null,
            createdAt: session.user.createdAt,
          },
          accounts: accounts.map(({ id, providerId, accountId, createdAt, updatedAt }) => ({
            id,
            providerId,
            accountId,
            createdAt,
            updatedAt,
          })),
        });
        return true;
      }

      return false;
    },
  };
}

export function authFromEnvironment(env = process.env) {
  return createBloomAuth({ env });
}
