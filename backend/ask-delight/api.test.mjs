import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAskDelight, usagePoints } from "./api.mjs";
import { lookupRelease } from "./modrinth.mjs";

const route = "/minecraft/v1/social/ask-delight/";
const input = (id = randomUUID()) => ({
  id, question: "Does Iris work with all shader packs?", recent: [],
  context: { build: "1.1.8", platform: "windows", page: "instance", loader: "fabric" },
});

async function fixture(t, options = {}, second = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "ask-delight-"));
  let now = Date.UTC(2026, 10, 18, 12);
  const env = { ASK_DELIGHT_PROVIDER: "mock", ASK_DELIGHT_ENABLED: "true", ASK_DELIGHT_ALLOWLIST: "previous-tester",
    ASK_DELIGHT_DB_PATH: path.join(directory, "limits.sqlite"), ...options.env };
  const authenticate = request => ({ "Bearer token-a": { user_id: "a" }, "Bearer token-b": { user_id: "b" } })[request.headers.authorization];
  const config = { env, clock: () => now, authenticate, mockProvider: options.mockProvider, log: { warn() {}, error() {} } };
  const api = createAskDelight(config);
  const servers = [];
  t.after(async () => {
    for (const { server, worker } of servers) {
      await new Promise(resolve => server.close(resolve));
      worker.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });
  async function serve(worker) {
    const server = createServer((req, res) => void worker.handle(req, res, req.url.replace(/^\/minecraft\//, "/")));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push({ server, worker });
    return async (body, token = "token-a") => {
      const res = await fetch("http://127.0.0.1:" + server.address().port + route + (body ? "answer" : "usage"), {
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, ...await res.json() };
    };
  }
  return { api, env, request: await serve(api), other: second ? await serve(createAskDelight(config)) : null,
    advance: ms => { now += ms; } };
}

test("usage does not dispatch and forged identity, roles, tools and model are rejected", async t => {
  const { request, api, env } = await fixture(t);
  assert.equal((await request()).usage.dailyRemaining, 100);
  assert.equal(api.report().dailyNanodollars, 0);
  assert.equal((await request(input(), "bogus")).status, 401);
  assert.equal((await request({ ...input(), question: "Could you help me?" })).result.status, "clarify");
  assert.equal(api.report().dailyNanodollars, 0);
  for (const key of ["account", "model", "roles", "tools", "max_output_tokens"]) {
    assert.equal((await request({ ...input(), [key]: "b" })).status, 400);
  }
  assert.equal((await request(input())).result.action, "shaderpacks");
  assert.equal((await request()).usage.dailyRemaining, 95);
  assert.equal((await request(undefined, "token-b")).usage.dailyRemaining, 100);
  env.ASK_DELIGHT_ENABLED = "false";
  assert.equal((await request(input())).error, "paused");
});

test("account limits, burst limits, idempotency, and UTC reset are authoritative", async t => {
  const { request, advance } = await fixture(t);
  const id = randomUUID();
  assert.equal((await request(input(id))).status, 200);
  assert.equal((await request(input(id.toUpperCase()))).error, "duplicate");
  for (let index = 1; index < 20; index++) {
    advance(61_000);
    assert.equal((await request(input())).status, 200);
  }
  const state = await request(input());
  assert.equal(state.error, "daily");
  assert.equal(state.usage.monthlyRemaining, 900);
  advance(state.usage.dailyReset - state.usage.serverTime);
  for (let index = 0; index < 3; index++) assert.equal((await request(input())).status, 200);
  assert.equal((await request(input())).error, "burst");
});

test("shader slowdown questions compare graphics settings with Java memory", async t => {
  const { request } = await fixture(t);
  for (const question of [
    "My game runs smoothly until I turn on shaders. Should I give Minecraft more RAM, or try a lighter shader pack first?",
    "FPS drops with shaders enabled. Would adding memory help?",
  ]) {
    const { result } = await request({ ...input(), question });
    assert.match(result.answer, /^Try a lighter shader pack or a lower shader preset first\./);
    assert.match(result.answer, /Increase RAM only if Minecraft is actually running out of Java heap memory/);
    assert.deepEqual(result.helpIds, ["shaderpacks", "memory"]);
    assert.equal(result.action, null);
  }
  const { result } = await request({ ...input(), question: "Where do I add shaders and change RAM allocation?" });
  assert.doesNotMatch(result.answer, /^Try a lighter shader pack/);
});

test("live provider answers general Minecraft questions and grounds Delight guidance", async t => {
  const httpFetch = globalThis.fetch;
  const generations = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    if (target.hostname === "127.0.0.1") return httpFetch(url, options);
    assert.equal(target.origin, "https://api.openai.com");
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "gpt-6-luna");
    assert.equal(payload.reasoning.effort, "low");
    if (target.pathname === "/v1/responses/input_tokens") return Response.json({ input_tokens: 750 });
    assert.equal(target.pathname, "/v1/responses");
    assert.equal(payload.store, false);
    assert.equal(payload.max_output_tokens, 350);
    assert.deepEqual(payload.prompt_cache_options, { mode: "explicit" });
    const prompt = JSON.parse(payload.input);
    generations.push(prompt);
    let answer;
    if (prompt.question.includes("zombie villager")) {
      assert.deepEqual(payload.tools.map(t=>t.name),["read_minecraft_wiki"]);
      assert.equal(prompt.help, undefined);
      assert.equal(prompt.recent, undefined);
      assert.deepEqual(payload.text.format.schema.properties.action, { type: "null" });
      answer = { scope: "minecraft", answer: "Apply Weakness, then use a golden apple.", helpIds: [], status: "answered", action: null };
    } else if (prompt.question.includes("Global File Sync")) {
      assert.ok(prompt.help.some(entry => entry.id === "sync-instances" && entry.steps.includes("Utilities")));
      assert.deepEqual(payload.text.format.schema.properties.helpIds.items.enum, prompt.help.map(entry => entry.id));
      answer = { scope: "launcher", answer: "Find Global File Sync in Utilities.", helpIds: ["sync-instances"], status: "answered", action: null };
    } else {
      answer = { scope: "launcher", answer: "Invented launcher option.", helpIds: [], status: "answered", action: null };
    }
    return Response.json({ status: "completed", usage: { input_tokens: 750, output_tokens: 75 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });
  });
  const { request, api } = await fixture(t, { env: {
    ASK_DELIGHT_PROVIDER: "openai", ASK_DELIGHT_OPENAI_ENABLED: "true",
    ASK_DELIGHT_OPENAI_KEY: "test-only", ASK_DELIGHT_MODEL: "gpt-6-luna",
    ASK_DELIGHT_AVAILABLE_CREDIT_USD: "1", ASK_DELIGHT_PRICING_VERIFIED_AT: "2026-11-18",
  } });
  assert.equal((await request({ ...input(), question: "How do I cure a zombie villager?" })).result.answer, "Apply Weakness, then use a golden apple.");
  assert.deepEqual((await request({ ...input(), question: "Where can I sync settings in Delight with Global File Sync?" })).result,
    { answer: "Find Global File Sync in Utilities.", helpIds: [], status: "answered", action: null });
  assert.equal((await request({ ...input(), question: "How do I start its secret internal menu?" })).error, "provider_unavailable");
  assert.equal(generations.length, 3);
  assert.equal(api.report().dailyNanodollars, 3 * (750 * 100 + 75 * 500));
});

test("an Iris version follow-up uses one generation and cites the newest matching stable release", async t => {
  const httpFetch = globalThis.fetch;
  let generations = 0;
  const question = "I’m setting up shaders on Fabric for Minecraft 26.3. Which Iris file should I grab?";
  const recent = [];
  const args = { project: "iris", minecraft: "26.3", loader: "fabric" };
  const mod = { id: "p1", slug: "iris", title: "Iris", project_type: "mod" };
  const version = { id: "stable", project_id: "p1", version_type: "release", version_number: "1.2", loaders: ["fabric"], game_versions: ["26.3"], date_published: "2026-10-01" };
  let versions = [ { ...version, id: "old", date_published: "2026-09-01" },
    { ...version, id: "beta", version_type: "beta", date_published: "2026-11-01" },
    { ...version, id: "other", loaders: ["neoforge"], date_published: "2026-11-02" }, version ];
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    if (target.hostname === "127.0.0.1") return httpFetch(url, options);
    if (target.hostname === "api.modrinth.com") {
      if (target.pathname === "/v2/project/iris") return Response.json(mod, { status });
      assert.equal(target.pathname, "/v2/project/iris/version");
      assert.equal(target.searchParams.get("game_versions"), '["26.3"]');
      assert.equal(target.searchParams.get("loaders"), '["fabric"]');
      return Response.json(versions);
    }
    assert.equal(target.hostname, "api.openai.com");
    assert.equal(JSON.parse(options.body).tools[0].name, "latest_modrinth_release");
    if (target.pathname.endsWith("/input_tokens")) return Response.json({ input_tokens: 800 });
    generations++;
    return Response.json({ status: "completed", usage: { input_tokens: 800, output_tokens: 70 },
      output: [{ type: "function_call", name: "latest_modrinth_release", arguments: JSON.stringify(args) }] });
  });
  const { request, api } = await fixture(t, { env: {
    ASK_DELIGHT_PROVIDER: "openai", ASK_DELIGHT_OPENAI_ENABLED: "true", ASK_DELIGHT_OPENAI_KEY: "test-only",
    ASK_DELIGHT_MODEL: "gpt-6-luna", ASK_DELIGHT_AVAILABLE_CREDIT_USD: "1", ASK_DELIGHT_PRICING_VERIFIED_AT: "2026-11-18",
  } });
  const reply = await request({ ...input(), question, recent });
  assert.equal(reply.result.status, "answered");
  assert.match(reply.result.answer, /Fabric is 1\.2\.\nhttps:\/\/modrinth\.com\/mod\/iris\/version\/stable$/);
  assert.equal(generations, 1);
  assert.equal(api.report().dailyNanodollars, 800 * 100 + 70 * 500);
  versions = [];
  assert.match((await lookupRelease(args, { question, recent })).answer, /no stable release/);
  status = 429;
  assert.equal((await lookupRelease(args, { question, recent })).status, "unsupported");
  assert.equal((await lookupRelease({ ...args, minecraft: "1.1.8" }, { question, recent })).status, "clarify");
});

test("monthly limits aggregate across daily resets", async t => {
  const day = 86_400_000;
  const { request, advance } = await fixture(t);
  for (let date = 0; date < 10; date++) {
    for (let index = 0; index < 20; index++) {
      assert.equal((await request(input())).status, 200);
      advance(61_000);
    }
    advance(day - 1_220_000);
  }
  const blocked = await request(input());
  assert.equal(blocked.error, "monthly");
  assert.equal(blocked.usage.dailyRemaining, 100);
  advance(blocked.usage.monthlyReset - blocked.usage.serverTime);
  assert.equal((await request()).usage.monthlyRemaining, 1000);
});

test("workers share an atomic budget, keep ambiguous charges and block same-account overlap", async t => {
  let started;
  let release;
  const dispatched = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { request, other, api } = await fixture(t, {
    env: { ASK_DELIGHT_DAILY_USD: "0.000575" },
    mockProvider: async () => { calls++; started(); await wait; throw Error("lost response"); },
  }, true);
  const first = request(input());
  try {
    await dispatched;
    const blocked = await other(input(), "token-b");
    assert.equal(blocked.error, "budget");
    assert.equal(blocked.usage.dailyRemaining, 100);
    assert.equal(calls, 1);
  } finally { release(); }
  assert.equal((await first).error, "provider_unavailable");
  assert.equal(api.report().dailyNanodollars, 575_000);
  assert.equal((await other(input(), "token-b")).error, "budget");
});

test("one in flight and invalid action IDs never reach the launcher", async t => {
  let started;
  let release;
  const dispatched = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const { request, other } = await fixture(t, { mockProvider: async () => {
    started(); await wait;
    return { usage: { input: 1000, output: 100 }, result: {
      answer: "Shaders", helpIds: ["shaderpacks"], status: "answered", action: "https://example.com",
    } };
  } }, true);
  const first = request(input());
  try {
    await dispatched;
    assert.equal((await other(input())).error, "in_flight");
  } finally { release(); }
  assert.equal((await first).result, undefined);
  assert.equal((await request()).usage.dailyRemaining, 95);
});

test("missing durable store or missing OpenAI gate fails closed", async t => {
  const missingStore = await fixture(t, { env: { ASK_DELIGHT_DB_PATH: "" } });
  assert.equal((await missingStore.request(input())).error, "paused");
  const defaultOff = await fixture(t, { env: { ASK_DELIGHT_PROVIDER: "openai" } });
  assert.equal((await defaultOff.request(input())).error, "paused");
});
test("a Paper docs question reads the guide and interprets evidence within the same reservation", async t => {
  const httpFetch = globalThis.fetch;
  let generations = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    if (target.hostname === "127.0.0.1") return httpFetch(url, options);
    if (target.hostname === "docs.papermc.io") {
      assert.equal(target.pathname, "/paper/adding-plugins/index.md");
      return new Response("Check the startup log for missing dependencies when a plugin does not enable.");
    }
    assert.equal(target.hostname, "api.openai.com");
    if (target.pathname.endsWith("/input_tokens")) return Response.json({ input_tokens: 600 });
    const payload = JSON.parse(options.body);
    generations++;
    if (generations === 1) return Response.json({ status: "completed", usage: { input_tokens: 600, output_tokens: 65 },
      output: [{ type: "function_call", name: "read_server_docs", arguments: JSON.stringify({ topic: "paper_plugins", terms: "missing dependency" }) }] });
    assert.equal(payload.tools, undefined);
    assert.equal(payload.max_output_tokens, 285);
    assert.match(JSON.parse(payload.input).excerpt, /missing dependencies/);
    return Response.json({ status: "completed", usage: { input_tokens: 600, output_tokens: 35 },
      output: [{ type: "message", content: [{ type: "output_text", text: "Check whether the plugin enabled during startup." }] }] });
  });
  const { request, api } = await fixture(t, { env: {
    ASK_DELIGHT_PROVIDER: "openai", ASK_DELIGHT_OPENAI_ENABLED: "true", ASK_DELIGHT_OPENAI_KEY: "test-only",
    ASK_DELIGHT_MODEL: "gpt-6-luna", ASK_DELIGHT_AVAILABLE_CREDIT_USD: "1", ASK_DELIGHT_PRICING_VERIFIED_AT: "2026-11-18",
  } });
  const response = await request({ ...input(), question: "My Paper server starts but my plugin command is missing. Why?" });
  assert.equal(response.result.status, "answered");
  assert.match(response.result.answer, /https:\/\/docs\.papermc\.io\/paper\/adding-plugins\/$/);
  assert.equal(generations, 2);
  assert.equal(api.report().dailyNanodollars, 1200 * 100 + 100 * 500);
});

test("client help grounds paraphrases and page-specific questions with bounded context", async () => {
  const { retrieve } = await import("./provider.mjs");
  for (const [question, expected] of [
    ["where can i add multiple minecraft accounts and switch between them", "minecraft-accounts"],
    ["How do I invite my friends?", "party-invites"],
    ["How do I filter mods?", "catalog-details"],
    ["What is the island at the top?", "island"],
    ["how do i get my screenshot into my clipboard", "screenshots-tools"],
    ["can i make it remember the last page", "ui-client-settings-general-startup-behavior"],
    ["I want the servers from one setup in another", "sync-instances"],
    ["what can I do on this screen?", "wardrobe"],
  ]) {
    const request = input();
    request.context.page = "locker";
    const entries = retrieve({ ...request, question }, true);
    assert.ok(entries.length <= 3);
    assert.ok(entries.some(entry => entry.id === expected), question);
  }
});

test("pack previews only expose verified client mods and accept revisions", async () => {
  const { draftPack, validPackContext } = await import("./pack.mjs");
  const { validateResult } = await import("./provider.mjs");
  const args = { name: "Explorer", minecraft: "1.21.1", loader: "fabric", count: 1, mods: ["compass","missing","compass"] };
  const get = async url => {
    const path = new URL(url);
    if (path.pathname.endsWith("/search")) return Response.json({hits:[]});
    if (path.pathname.includes("missing")) return new Response(null,{status:404});
    if (path.pathname.endsWith("/version")) {
      assert.equal(path.searchParams.get("game_versions"), '["1.21.1"]');
      return Response.json([{project_id:"abc123",loaders:["fabric"],game_versions:["1.21.1"],files:[{filename:"compass.jar"}]}]);
    }
    return Response.json({id:"abc123",slug:"compass",title:"Compass",project_type:"mod"});
  };
  const result = validateResult(await draftPack(args,get),[],true);
  assert.deepEqual(result.pack.mods,[{id:"abc123",slug:"compass",title:"Compass"}]);
  assert.equal((await draftPack({...args,count:6},get)).pack, undefined);
  assert.ok(validPackContext({...result.pack,mods:["compass"]}));
  assert.equal((await draftPack({...args,loader:"forge"},get)).status,"clarify");
});

test("fills six and seventy mod drafts with unique compatible replacements", async () => {
  const {draftPack} = await import("./pack.mjs");
  const hits = Array.from({length:90},(_,i)=>({project_type:"mod",project_id:"mod"+i,title:"Explorer "+i,slug:"explorer-"+i,categories:["adventure"]}));
  const read = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith("/search")) return Response.json({hits});
    if (path.endsWith("/version")) {
      const id = path.split("/").at(-2);
      return Response.json([{project_id:id,loaders:["fabric"],game_versions:["1.21.1"],files:[{filename:"test.jar"}]}]);
    }
    return new Response(null,{status:404});
  };
  for (const [question,size] of [["six-mod adventure pack",6],["70 mods for an adventure pack",70]]) {
    const result = await draftPack({name:"Explorer",loader:"fabric",minecraft:"1.21.1",count:3,categories:["adventure"],mods:["missing"]},read,true,question);
    assert.equal(new Set(result.pack.mods.map(m=>m.id)).size,size);
  }
});

test("launcher answers link only to destinations backed by cited help", async () => {
  const {validateResult,retrieve} = await import("./provider.mjs");
  for (const [question,destination] of [["Where do I switch accounts?","minecraft-accounts"],["How do I change this instance's RAM?","instance-memory"]]) {
    const args = {...input(),question};
    const entries = retrieve(args,true);
    const id = destination === "instance-memory" ? "ui-open-an-instance-minecraft-memory" : destination;
    assert.ok(entries.some(e=>e.id===id));
    const answer = {answer:"Open settings.",scope:"launcher",status:"answered",action:null,helpIds:[id]};
    assert.equal(validateResult(answer,entries,true).destination,destination);
    assert.equal(validateResult({...answer,status:"clarify"},entries,true).destination,undefined);
  }
});

test("quota charges scale with model work and verified draft size", () => {
  assert.equal(usagePoints(0,null),0);
  assert.equal(usagePoints(20_000,{}),1);
  assert.equal(usagePoints(575_000,{}),5);
  assert.equal(usagePoints(100_000,{pack:{mods:Array(6)}}),10);
  assert.equal(usagePoints(100_000,{pack:{mods:Array(70)}}),22);
});

test("gameplay and fresh topics stay independent of release and troubleshooting tools", async () => {
  const {toolsForQuestion} = await import("./provider.mjs");
  const history = [["What’s the latest Minecraft snapshot?", "Here is the snapshot."]];
  const names = (q,recent=history,context={}) => toolsForQuestion(q,recent,context).map(t=>t.name);
  for (const q of ["what y level can i find each ore","How do I cure a villager?","How do hostile mobs spawn in 1.21.1?",
    "What enchantments work together?","How do I power a piston in the latest version?","Where do I find ancient debris?",
    "What version introduced shields?","What can I craft with copper?"]) assert.deepEqual(names(q),["read_minecraft_wiki"],q);
  assert.deepEqual(names("Where do diamonds spawn?",history,{pack:{mods:["sodium"]}}),["read_minecraft_wiki"]);
  assert.deepEqual(names("What's the latest Java release?"),["current_java_version"]);
  assert.deepEqual(names("Is Minecraft 26.3 out yet?"),["current_java_version"]);
  assert.deepEqual(names("what about the snapshot?"),["current_java_version"]);
  assert.deepEqual(names("Fabric", [["Which Iris file should I install for 1.21.1?","Which loader?"]]),["latest_modrinth_release"]);
  assert.ok(names("Why does my Paper server reject this plugin?").includes("read_server_docs"));
});

test("Wiki lookup uses matching section, preserves table cells, and caches the excerpt", async () => {
  const {readWiki} = await import("./wiki.mjs");
  const calls = [];
  const read = async url => {
    const query = new URL(url).searchParams;
    calls.push(query);
    if (query.get("list") === "search") return Response.json({query:{search:[{ns:0,pageid:12,title:"Example mechanic"}]}});
    if (query.get("prop") === "sections") return Response.json({parse:{sections:[{index:"3",line:"Spawning"}]}});
    assert.equal(query.get("section"),"3");
    return Response.json({parse:{text:"<table><tr><td>Range</td><td>12</td></tr></table>"}});
  };
  const args = {topic:"Example mechanic",terms:"spawning altitude"};
  const first = await readWiki(args,read);
  assert.match(first.excerpt,/Range \| 12/);
  assert.equal(first.url,"https://minecraft.wiki/w/Example_mechanic");
  assert.deepEqual(await readWiki(args,read),first);
  assert.equal(calls.length,3);
});

test("suggested replies only accompany a necessary clarification", async () => {
  const {validateResult} = await import("./provider.mjs");
  const response = {scope:"minecraft", status:"clarify", answer:"Which edition?", helpIds:[], action:null, choices:["Java","Bedrock"]};
  assert.deepEqual(validateResult(response,[],true).choices,["Java","Bedrock"]);
  assert.equal(validateResult({...response,status:"answered"},[],true).choices,undefined);
  assert.equal(validateResult({...response,choices:["Java","java"]},[],true).choices,undefined);
});


test("attached inventories arrive complete at the provider with independent question and inventory limits", async t => {
  const seen = [];
  const {request} = await fixture(t, {mockProvider: async (data, entries) => {
    seen.push(data); return {usage:{input:4500, output:20}, result:{answer:"Reviewed.", status:"answered", action:null, helpIds:[entries[0].id]}};
  }});
  const data = input();
  const inventory = {name:"Meadow", minecraft:"1.21.1", loader:"Fabric", loaderVersion:"0.18.4", source:"installed",
    mods:Array.from({length: 500}, (_,i) => "Performance mod " + i + " 1.22.333"), disabled:["Optional mod 2.3"]};
  data.context.inventory = inventory;
  assert.equal((await request(data)).result.answer,"Reviewed.");
  assert.deepEqual(seen[0].context.inventory, inventory);
  const oversized = {...data, id:randomUUID(), context:{...data.context, inventory:{...inventory, mods:["a".repeat(50000)]}}};
  assert.equal((await request(oversized)).error,"invalid_request");
  assert.equal(seen.length,1);
});
