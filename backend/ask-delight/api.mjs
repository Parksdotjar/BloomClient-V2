import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { MODEL, inputLimit, INPUT_LIMIT, OUTPUT_LIMIT, INPUT_PRICE, OUTPUT_PRICE, validateInput, retrieve, validateResult, openAi, mock } from "./provider.mjs";

const prefix = "/v1/social/ask-delight/";
const DAY = 86_400_000;
const LEASE = 120_000;
const DAILY_POINTS = 100;
const MONTHLY_POINTS = 1000;
export function usagePoints(cost, result) {
  if (result?.pack) return 8 + 2 * Math.ceil(result.pack.mods.length / 10);
  return Math.min(5, Math.ceil(cost / 30_000));
}
const RESERVE = INPUT_LIMIT * INPUT_PRICE + OUTPUT_LIMIT * OUTPUT_PRICE;

function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readInput(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 12_000 + 49152) { request.resume(); throw new Error("request_too_large"); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function windows(now) {
  const date = new Date(now);
  const day = Math.floor(now / DAY) * DAY;
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return { day, month, dailyReset: day + DAY, monthlyReset: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}

export function createAskDelight({ authenticate, env = process.env, clock = Date.now, mockProvider = mock, log = console }) {
  const mode = env.ASK_DELIGHT_PROVIDER;
  const credit = Number(env.ASK_DELIGHT_AVAILABLE_CREDIT_USD);
  const verified = Date.parse(env.ASK_DELIGHT_PRICING_VERIFIED_AT);
  const provider = mode === "mock" ? mockProvider : (data, entries) => openAi(env.ASK_DELIGHT_OPENAI_KEY, data, entries);
  const limit = (value, ceiling) => value === undefined ? ceiling
    : Math.max(0, Math.min(ceiling, Math.floor(Number(value) * 1e9) || 0));
  const caps = { daily: limit(env.ASK_DELIGHT_DAILY_USD, 1e9), monthly: limit(env.ASK_DELIGHT_MONTHLY_USD, 10e9) };
  if (mode === "openai") {
    for (const key of Object.keys(caps)) caps[key] = limit(credit, caps[key]);
  }

  let db;
  try {
    db = env.ASK_DELIGHT_DB_PATH && path.isAbsolute(env.ASK_DELIGHT_DB_PATH)
      ? new DatabaseSync(env.ASK_DELIGHT_DB_PATH) : undefined;
    db?.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS ask_attempts (
        account TEXT NOT NULL, request_id TEXT NOT NULL, ip_hash TEXT NOT NULL,
        started INTEGER NOT NULL, settled INTEGER, cost INTEGER NOT NULL, outcome TEXT,
        PRIMARY KEY (account, request_id)
      );
      CREATE INDEX IF NOT EXISTS ask_attempts_started ON ask_attempts(started);
      CREATE INDEX IF NOT EXISTS ask_attempts_ip ON ask_attempts(ip_hash, started);
      CREATE TABLE IF NOT EXISTS ask_usage_points (
        account TEXT NOT NULL, request_id TEXT NOT NULL, points INTEGER NOT NULL,
        PRIMARY KEY (account, request_id)
      );
      CREATE TABLE IF NOT EXISTS ask_alerts (period TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS ask_daily_credits (
        account TEXT NOT NULL, day INTEGER NOT NULL, credit INTEGER NOT NULL,
        PRIMARY KEY (account, day)
      );
      CREATE TABLE IF NOT EXISTS ask_pauses (reason TEXT PRIMARY KEY);
    `);
  } catch {
    db?.close();
    db = undefined;
    log.error("[Ask Delight] quota storage unavailable");
  }

  const enabled = now => env.ASK_DELIGHT_ENABLED === "true" && (mode === "mock"
    || (mode === "openai" && env.ASK_DELIGHT_OPENAI_ENABLED === "true"
      && env.ASK_DELIGHT_MODEL === MODEL && Boolean(env.ASK_DELIGHT_OPENAI_KEY)
      && Number.isFinite(credit) && credit > 0 && verified <= now && verified > now - 30 * DAY));

  function spend(since) {
    return db.prepare(`SELECT COALESCE(SUM(cost), 0) AS total FROM ask_attempts
      WHERE started >= ? OR settled >= ? OR (settled IS NULL AND started >= ?)`).get(since, since, since - LEASE).total;
  }

  function usage(account, now, reservation = RESERVE) {
    const { day, month, dailyReset, monthlyReset } = windows(now);
    // Earlier builds charged each dispatch as one tenth of the daily allowance.
    const used = since => db.prepare(`SELECT COALESCE(SUM(COALESCE(p.points, 10)),0) AS n
      FROM ask_attempts a LEFT JOIN ask_usage_points p USING(account, request_id)
      WHERE a.account=? AND a.started>=?`).get(account, since).n;
    const creditToday = db?.prepare("SELECT credit FROM ask_daily_credits WHERE account=? AND day=?").get(account, day)?.credit ?? 0;
    const dailyRemaining = db ? Math.min(DAILY_POINTS, Math.max(0, DAILY_POINTS + creditToday * 10 - used(day))) : null;
    const monthlyRemaining = db ? Math.max(0, MONTHLY_POINTS - used(month)) : null;
    let blocking = null;
    if (!db || !enabled(now) || db.prepare("SELECT 1 FROM ask_pauses LIMIT 1").get()) blocking = "paused";
    else if (monthlyRemaining === 0) blocking = "monthly";
    else if (dailyRemaining === 0) blocking = "daily";
    else if (spend(day) + reservation > caps.daily || spend(month) + reservation > caps.monthly
        || (mode === "openai" && spend(verified) + reservation > Math.floor(credit * 1e9))) blocking = "budget";
    return { dailyLimit: DAILY_POINTS, monthlyLimit: MONTHLY_POINTS, dailyRemaining, monthlyRemaining, dailyReset, monthlyReset, serverTime: now, blocking, mode: mode === "mock" ? "mock" : "ai" };
  }

  function reserve(account, id, ip, now, reservation) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // Preserve a crashed reservation through the next window if it straddles a reset.
      db.prepare("UPDATE ask_attempts SET settled=started+?, outcome='ambiguous' WHERE settled IS NULL AND started<=?")
        .run(LEASE, now - LEASE);
      let error = usage(account, now, reservation).blocking;
      const exists = db.prepare("SELECT 1 FROM ask_attempts WHERE account=? AND request_id=?").get(account, id);
      if (exists) error = "duplicate";
      else if (!error && db.prepare("SELECT 1 FROM ask_attempts WHERE account=? AND settled IS NULL").get(account)) error = "in_flight";
      else if (!error && db.prepare("SELECT COUNT(*) AS n FROM ask_attempts WHERE account=? AND started>=?").get(account, now - 60_000).n >= 3) error = "burst";
      else if (!error && db.prepare("SELECT COUNT(*) AS n FROM ask_attempts WHERE ip_hash=? AND started>=?").get(ip, now - 60_000).n >= 60) error = "ip_limit";
      if (!error) {
        db.prepare("INSERT INTO ask_attempts(account,request_id,ip_hash,started,cost) VALUES(?,?,?,?,?)").run(account, id, ip, now, reservation);
        db.prepare("INSERT INTO ask_usage_points VALUES(?,?,?)").run(account,id,usagePoints(reservation,null));
        const { day, month } = windows(now);
        for (const [period, since, cap] of [["day", day, caps.daily], ["month", month, caps.monthly]]) {
          const total = spend(since);
          if (total >= cap * 0.8 && db.prepare("INSERT OR IGNORE INTO ask_alerts VALUES(?)").run(period + ":" + since).changes) {
            log.warn("[Ask Delight] spend alert", { period, usedNanodollars: total, capNanodollars: cap, mode });
          }
        }
      }
      db.exec("COMMIT");
      return error;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    report(now = clock()) {
      if (!db) return null;
      const { day, month } = windows(now);
      return { dailyNanodollars: spend(day), monthlyNanodollars: spend(month),
        outcomes: db.prepare("SELECT outcome, COUNT(*) AS attempts FROM ask_attempts WHERE started>=? GROUP BY outcome").all(month) };
    },
    close() { db?.close(); },
    async handle(request, response, pathname) {
      if (!pathname.startsWith(prefix)) return false;
      try {
        const account = authenticate(request)?.user_id;
        if (!account) { send(response, 401, { error: "signed_out" }); return true; }
        if (pathname === prefix + "usage" && request.method === "GET") {
          send(response, 200, { usage: usage(account, clock()) });
        } else if (pathname === prefix + "answer" && request.method === "POST") {
          let input;
          try { input = validateInput(await readInput(request)); } catch { /* Invalid payload. */ }
          if (!input) { send(response, 400, { error: "invalid_request" }); return true; }
          if (authenticate(request)?.user_id !== account) { send(response, 401, { error: "signed_out" }); return true; }
          const now = clock();
          const live = mode === "openai";
          const entries = retrieve(input, live);
          if (!live && !entries.length) {
            send(response, 200, { usage: usage(account, now), result: {
              answer: "Which part of Delight Client do you need help with?", helpIds: [], status: "clarify", action: null,
            } });
            return true;
          }
          const ip = createHash("sha256").update(request.socket.remoteAddress || "unknown").digest("hex");
          const ceiling = inputLimit(input.context);
          const reservation = ceiling * INPUT_PRICE + OUTPUT_LIMIT * OUTPUT_PRICE;
          const error = db ? reserve(account, input.id, ip, now, reservation) : "paused";
          if (error) { send(response, 429, { error, usage: usage(account, clock()) }); return true; }
          let result = null;
          let cost = reservation;
          let outcome = "ambiguous";
          try {
            const output = await provider(input, entries);
            result = validateResult(output.result, entries, live);
            const { input: inputUsed, output: outputUsed } = output.usage ?? {};
            if (Number.isInteger(inputUsed) && inputUsed >= 0 && Number.isInteger(outputUsed) && outputUsed >= 0) {
              cost = inputUsed * INPUT_PRICE + outputUsed * OUTPUT_PRICE;
              outcome = result ? "answered" : "unavailable";
            }
            if (inputUsed > ceiling || outputUsed > OUTPUT_LIMIT || cost > reservation) {
              db.prepare("INSERT OR IGNORE INTO ask_pauses VALUES('provider_usage_exceeded')").run();
              log.error("[Ask Delight] provider usage exceeded token ceilings; dispatch paused");
              result = null;
              outcome = "usage_exceeded";
            }
          } catch { /* Preserve the reservation for ambiguous provider billing. */ }
          db.exec("BEGIN IMMEDIATE");
          try {
            const settled = db.prepare("UPDATE ask_attempts SET settled=?, cost=?, outcome=? WHERE account=? AND request_id=? AND settled IS NULL")
              .run(clock(), cost, outcome, account, input.id);
            if (settled.changes) db.prepare("UPDATE ask_usage_points SET points=? WHERE account=? AND request_id=?")
              .run(usagePoints(cost,result),account,input.id);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          send(response, result ? 200 : 503, { ...(result ? { result } : { error: "provider_unavailable" }), usage: usage(account, clock()) });
        } else send(response, 404, { error: "not_found" });
      } catch {
        log.error("[Ask Delight] request failed closed");
        if (!response.headersSent) send(response, 503, { error: "paused" });
      }
      return true;
    },
  };
}
