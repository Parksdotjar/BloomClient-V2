// Exercise the real launcher UI on Vite with native commands simulated.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
const screenshots = process.env.WORKSPACE_SCREENSHOTS;

function initializeLibrary(options) {
  const { theme, animations = false } = typeof options === "string" ? { theme: options } : options;
  if (sessionStorage.getItem("test-first-start")) localStorage.removeItem("bloom-onboarding-complete-v1");
  else localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme, animations, redesignAppearanceV1: true }));
  const instances = ["Pine Hollow", "Skyblock"].map((name, index) => ({
    id: String(index + 1), name, version: index ? "1.21.4" : "1.21.1", loader: index ? "Vanilla" : "Fabric",
    loaderVersion: index ? null : "0.16.10",
    directory: "test/" + name, java: "Automatic", memory: 4096, jvmArguments: "",
    mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true,
    icon: index ? undefined : "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="80"><rect width="96" height="80" fill="#8ca6a8"/><path d="M0 56 30 22 54 51 72 35 96 58V80H0" fill="#4a6861"/><path d="M0 67 24 52 44 65 68 47 96 64V80H0" fill="#284c43"/></svg>'),
  }));
  let next = 1;
  const callbacks = new Map();
  const events = new Map();
  const playerUrl = "https://delightproductions.org/share/pack/PNHLW234";
  const followedId = "followed-pine-hollow";
  const playerFile = (category, fileName, enabled, size) => ({ category, fileName, enabled, size, source: "modrinth",
    projectId: category === "mods" ? "project-ferritecore" : "project-stonework",
    versionId: category === "mods" ? "FcSample1" : "StSample3", sha512: "a".repeat(128) });
  const playerRelease = { code: "PNHLW234", url: playerUrl, revision: 1, creator: "River", releaseNote: "Welcome to our first community release.",
    manifest: { name: "Pine Hollow", minecraftVersion: "1.21.1", loaderVersion: "0.16.10", loader: "fabric", excludedFolders: ["config"],
      files: [playerFile("mods", "ferritecore-7.0.2-fabric.jar", true, 121856), playerFile("resourcepacks", "Stonework.zip.disabled", false, 433045)] } };
  if (options.revisions) {
    localStorage.setItem("test-followed", "yes");
    localStorage.setItem("test-pack:1", JSON.stringify({revision: 1, code: "PNHLW234", playerUrl, releaseNote: playerRelease.releaseNote}));
  }
  const revisions = {installed: 1, head: 1, floor: 1, reason: "", notes: {1: playerRelease.releaseNote},
    manifests: {1: playerRelease.manifest}, launches: [], updates: [], restores: [], repairs: [], repairNeeded:false, error: ""};
  window.revisionTest = revisions;
  const editId = "-edit-fixture";
  const draftRows = [];
  window.draftAuthorAvatarUrl = options.draftAvatarUrl ?? null;
  if (options.drafts) instances.push({...instances[0], id:editId, name:"Pine Hollow (Working copy)"});
  const invites = {sharingEnabled:true, links:[], people:[{id:"editor", name:"Lake", role:"edit", canPublish:false}]};
  window.sharingChanges = [];
  const inviteUrl = "https://api.north.bloomclient.org/minecraft/share/invite#" + "Z".repeat(43);
  if (localStorage.getItem("test-followed")) instances.push({ ...instances[0], id: followedId, name: "Pine Hollow (2)" });
  window.playerTest = { queue: JSON.parse(sessionStorage.getItem("test-player-links") || "[]"), installed: 0, previews: 0,
    send(event, payload) { callbacks.get(events.get(event))?.({event, payload}); } };
  sessionStorage.removeItem("test-player-links");
  const contents = {
    mods: [
      { name: "FerriteCore", fileName: "ferritecore.jar", version: "7.0.2", size: 121856, enabled: true },
      { name: "Iris", fileName: "iris.jar.disabled", version: "1.8.0", size: 2964230, enabled: false },
    ],
    resourcepacks: [{ name: "Stonework", fileName: "stonework.zip", version: "1.1", size: 433045, enabled: true }],
    shaderpacks: [],
  };
  const duplicateVersions = [
    { ...contents.mods[0], sha512: "a".repeat(128) },
    { ...contents.mods[0], fileName: "ferritecore-6.0.0.jar", version: "6.0.0", sha512: "b".repeat(128) },
  ];
  const customMod = { name: "Local HUD", fileName: "local-hud.jar", version: "1.0", size: 5300, enabled: true, sha512: "c".repeat(128) };
  const missingDependencies = [
    { projectId: "fabric", versionId: "fabric-pin", requiredBy: ["ferritecore.jar", "stonework.zip"] },
    { projectId: "iris", versionId: null, requiredBy: ["stonework.zip"] },
  ];
  const dependencyActions = [
    { name: "Fabric API", version: "0.116.7", fileName: "fabric-api.jar", kind: "install", requiredBy: missingDependencies[0].requiredBy },
    { name: "Iris", version: "1.8.0", fileName: "iris.jar", kind: "enable", requiredBy: missingDependencies[1].requiredBy },
  ];
  const inventory = category => {
    if (window.compatibility.mode === "managed") return category === "mods" ? [{
      id: "managed-cosmetics", name: "Delight Cosmetics", version: "1.6.1", size: 2480000,
      fileName: "bloom-cosmetics-1.21.1.jar", enabled: true,
    }] : [];
    if (window.compatibility.mode === "resolution" && category === "mods") {
      const kept = window.compatibility.keptVersion;
      return [
        ...duplicateVersions.map(item => kept && kept !== item.fileName
          ? { ...item, fileName: item.fileName + ".disabled", enabled: false } : item),
        contents.mods[1],
        { ...customMod, sha512: window.compatibility.customChanged ? "d".repeat(128) : customMod.sha512 },
      ].map(item => ({ id: item.fileName, ...item }));
    }
    if (window.compatibility.mode === "dependencies" && window.compatibility.dependenciesApplied && category === "mods") {
      return [contents.mods[0], { ...contents.mods[1], fileName: "iris.jar", enabled: true },
        { name: "Fabric API", fileName: "fabric-api.jar", enabled: true, version: "0.116.7", size: 71205 }]
        .map(item => ({ id: item.fileName, ...item }));
    }
    return contents[category].map(item => ({ id: item.fileName, ...item }));
  };
  const releaseIds = { FerriteCore: "FcSample1", Iris: "IrSample2", Stonework: "StSample3" };
  window.compatibility = { mode: "ready", requests: [], selectionRequests: [], resolveRequests: [], dependencyReviews: [], dependencyApplies: [] };
  window.publicationTest = {
    publisher: { id: "river", name: "River", termsAccepted: false }, requests: [], clipboard: "",
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    async writeText(value) {
      if (window.publicationTest.copyDenied) throw new Error("Clipboard is unavailable");
      window.publicationTest.clipboard = value;
    },
  } });
  window.packCalls = [];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(fn) { const id = next++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      window.packCalls.push(command);
      switch (command) {
        case "list_instances": return instances;
        case "list_minecraft_accounts": return { activeId: null, accounts: [] };
        case "request_microsoft_device_code": return { user_code: "SAMPLE", verification_uri: "https://microsoft.com/devicelogin", device_code: "test", interval: 1, expires_in: 120 };
        case "complete_microsoft_login": return {id:"test-player",name:"Player"};
        case "get_minecraft_launch_status": return { active: false, progress: 0, state: "idle", message: "" };
        case "get_minecraft_process_running":
        case "plugin:window|is_maximized": return false;
        case "get_minecraft_releases": return [{ id: "1.21.1", type: "release" }];
        case "take_workspace_player_links": return window.playerTest.queue.splice(0);
        case "preview_player_pack": {
          if (![playerUrl, "delight://pack/PNHLW234"].includes(args.link)) throw "Enter a valid Delight player link.";
          const installedInstanceId = instances.some(item => item.id === followedId) ? followedId : null;
          const release = structuredClone(playerRelease);
          if (window.playerTest.longList) {
            for (let i = 1; i <= 80; i++) release.manifest.files.push(playerFile("mods", `test-library-${i}.jar`, true, 1024));
            for (let i = 1; i <= 50; i++) release.manifest.files.push(playerFile("resourcepacks", `textures-${i}.zip`, true, 2048));
          }
          const downloadBytes = release.manifest.files.reduce((total, file) => total + file.size, 0);
          return { playerUrl, installedInstanceId, release, reviewToken: "token-" + (++window.playerTest.previews), downloadBytes };
        }
        case "install_followed_pack": {
          if (args.link !== playerUrl || args.reviewToken !== "token-" + window.playerTest.previews) throw "Unexpected review";
          if (window.playerTest.error) throw window.playerTest.error;
          if (window.playerTest.gate) await window.playerTest.gate;
          window.playerTest.installed++;
          instances.push({ ...instances[0], id: followedId, name: "Pine Hollow (2)" });
          localStorage.setItem("test-followed", "yes");
          return followedId;
        }
        case "get_followed_pack": return args.instanceId === followedId ? {playerUrl, revision: revisions.installed, creator: "River"} : null;
        case "workspace_manage_access": {
          const action = args.action;
          if (!action) return {role:"owner", ...structuredClone(invites)};
          if (action.action === "setSharing") {
            invites.sharingEnabled = action.enabled;
            window.sharingChanges.push({instanceId:args.instanceId, enabled:action.enabled});
            return {sharingEnabled:invites.sharingEnabled};
          }
          if (action.action === "create") {
            if (!invites.sharingEnabled) throw "The pack owner has paused sharing.";
            const id = "invite-" + invites.links.length;
            invites.links.unshift({id, role:action.role, expiresAt:action.expiresInHours ? Date.now() + action.expiresInHours * 3600000 : null,
              maxUses:action.maxUses, uses:0, revokedAt:null});
            return {id, url:inviteUrl};
          }
          if (action.action === "revoke") invites.links.find(link => link.id === action.id).revokedAt = Date.now();
          if (action.action === "publish") invites.people.find(person => person.id === action.id).canPublish = action.enabled;
          if (action.action === "remove") invites.people = invites.people.filter(person => person.id !== action.id);
          return {};
        }
        case "workspace_invitation": {
          if (args.link !== inviteUrl && args.link !== "delight://invite/" + "Z".repeat(43)) throw new Error("Invalid invite");
          if (!invites.sharingEnabled) throw "The pack owner has paused sharing.";
          return {name:"Pine Hollow", role:"edit", playerUrl, creator:"River"};
        }
        case "create_workspace_working_copy": {
          if (!instances.some(item => item.id === editId)) instances.push({...instances[0], id:editId, name:"Pine Hollow (Working copy)"});
          return editId;
        }
        case "get_workspace_collaboration": return args.instanceId === editId ? {
          publication:{revision:revisions.head, code:"PNHLW234", playerUrl, releaseNote:playerRelease.releaseNote},
          canPublish:false, workingBaseRevision:1,
        } : null;
        case "get_workspace_drafts": {
          const owner = args.instanceId !== editId;
          return {role:owner ? "owner" : "edit", ownerName:"River", headRevision:revisions.head,
            drafts:structuredClone(draftRows.filter(item => !owner || ["submitted","published"].includes(item.state)))};
        }
        case "get_workspace_draft": return structuredClone(draftRows.find(item => item.id === args.draftId));
        case "save_workspace_draft": {
          if (args.instanceId !== editId || !args.reviewToken) throw "Review your working copy.";
          const previous = draftRows.find(item => item.id === args.draftId);
          if (previous && previous.version !== args.version) throw "The draft changed.";
          const row = {id:args.draftId, version:(previous?.version ?? 0) + 1, author:"Lake", authorAvatarUrl:window.draftAuthorAvatarUrl, state:"saved", note:args.note,
            baseRevision:args.baseRevision, updatedAt:"2026-11-24T12:00:00Z", submittedAt:null, publishedRevision:null,
            canReview:true, reviewNote:previous?.reviewNote ?? "",
            manifest:{...playerRelease.manifest, excludedFolders:args.excludedFolders,
              files:[playerRelease.manifest.files[0], {...playerFile("mods","iris.jar.disabled",false,2964230), projectId:"project-iris"}]},
          };
          if (previous) Object.assign(previous,row);
          else draftRows.push(row);
          return structuredClone(row);
        }
        case "change_workspace_draft": {
          const row = draftRows.find(item => item.id === args.draftId);
          if (!row || row.version !== args.version) throw "The draft changed.";
          row.version++;
          if (args.action === "return") { row.state = "returned"; row.reviewNote = args.note; }
          if (args.action === "submit") { row.state = "submitted"; row.submittedAt = row.updatedAt; }
          if (args.action === "publish") {
            if (row.baseRevision !== revisions.head) throw "A newer version is live.";
            const revision = ++revisions.head;
            row.state = "published";
            row.publishedRevision = revision;
            revisions.notes[revision] = args.releaseNote;
            revisions.manifests[revision] = row.manifest;
            if (args.required) revisions.floor = revision;
            return {revision, code:"PNHLW234", playerUrl, releaseNote:args.releaseNote, required:args.required};
          }
          return structuredClone(row);
        }
        case "check_followed_pack_update": return args.instanceId !== followedId ? null : {
          installedRevision: revisions.installed, latestRevision: revisions.head, minimumPlayableRevision: revisions.floor,
          required: revisions.installed < revisions.floor, releaseNote: revisions.notes[revisions.head], creator: "River", playerUrl,
          repairNeeded: revisions.repairNeeded, minecraftVersionChanged:!!revisions.minecraftVersionChanged,
          reviewToken: "update-" + revisions.head, changes: revisions.installed < revisions.head ? [{
            category: "resourcepacks", kind: "changed", before: "Stonework (disabled)", after: "Stonework",
          }] : [],
        };
        case "get_workspace_release": {
          const revision = args.revision ?? revisions.head;
          return {...structuredClone(playerRelease), manifest:structuredClone(revisions.manifests[revision]),
            revision, releaseNote:revisions.notes[revision]};
        }
        case "get_workspace_release_history": return Object.entries(revisions.notes).reverse().map(([version, note]) => ({
          revision: Number(version), required: Number(version) === revisions.floor && revisions.floor > 1,
          releaseNote: note, creator: "River", createdAt: "2026-11-24T12:00:00Z",
        }));
        case "update_followed_pack": {
          if (revisions.error) throw revisions.error;
          if (revisions.repairNeeded) throw "Repair pack files before updating.";
          if (args.instanceId !== followedId || args.reviewToken !== "update-" + revisions.head) throw new Error("Wrong follow or review");
          revisions.updates.push(args.instanceId);
          revisions.installed = revisions.head;
          return followedId;
        }
        case "repair_followed_pack": {
          if (args.instanceId !== followedId) throw new Error("Choose a followed instance.");
          revisions.repairs.push(args.instanceId);
          revisions.repairNeeded = false;
          return {repairedFiles:1, backupDirectory:"P:/preview/Pine Hollow/Repair backup"};
        }
        case "launch_minecraft": {
          revisions.launches.push(args);
          setTimeout(() => window.playerTest.send("minecraft-launch-progress", {
            instanceId: args.instanceId, state: "idle", progress: 0, message: "",
          }), 0);
          return;
        }
        case "get_workspace_publication": {
          const receipt = JSON.parse(localStorage.getItem("test-pack:" + args.instanceId) || "null");
          if (receipt && args.refresh) return {...receipt, revision: revisions.head, releaseNote: revisions.notes[revisions.head]};
          return receipt;
        }
        case "get_pack_publisher": {
          const account = window.publicationTest.publisher;
          const owner = !args.instanceId || account?.id === "river";
          return account && { ...account, canPublish:owner, canRequire:owner };
        }
        case "social_prepare_sign_in": return { authorizationUrl: "https://delight.example/approve" };
        case "plugin:opener|open_url":
          window.publicationTest.openedUrl = args.url;
          return;
        case "social_poll_sign_in":
          window.publicationTest.publisher = { id: "lake", name: "Lake", termsAccepted: true };
          return { signedIn: true };
        case "publish_workspace_release": {
          const state = window.publicationTest;
          state.requests.push(args);
          if (state.gate) await state.gate;
          if (state.error) throw state.error;
          if (!state.publisher || args.publisherId !== state.publisher.id) throw { code: "signed_out", message: "Connect your Delight account again." };
          if (!args.acceptedTerms || !args.reviewToken) throw new Error("A reviewed release and consent are required.");
          if (args.baseRevision && args.baseRevision !== revisions.head) throw {code: "stale_base", message: "Review the latest release."};
          if (args.required && !args.releaseNote.trim()) throw new Error("Required update needs a reason");
          revisions.head = (args.baseRevision || 0) + 1;
          if (args.required) revisions.floor = revisions.head;
          revisions.notes[revisions.head] = args.releaseNote;
          const review = window.compatibility.latest;
          if (window.compatibility.mode === "resolution" && (review.reviewToken !== args.reviewToken ||
              JSON.stringify(args.excludedLocalFiles) !== JSON.stringify(review.excludedLocalFiles))) {
            throw { code: "stale_review", message: "Review the local file selections again." };
          }
          revisions.manifests[revisions.head] = {
            name: review.name, minecraftVersion: review.minecraftVersion, loaderVersion: review.loaderVersion,
            excludedFolders: [...review.excludedFolders], files: review.files.filter(file => file.state !== "localOnly")
              .map(file => ({...file, source: file.state === "managed" ? "delight" : "modrinth"})),
          };
          const release = { revision: revisions.head, code: "PNHLW234", playerUrl: "https://delight.example/share/pack/PNHLW234", releaseNote: args.releaseNote,
            required: !!args.required, minimumPlayableRevision: revisions.floor };
          state.publisher.termsAccepted = true;
          localStorage.setItem("test-pack:" + args.instanceId, JSON.stringify(release));
          return release;
        }
        case "restore_workspace_release": {
          if (args.instanceId !== "1" || window.publicationTest.publisher?.id !== "river") throw "Only the pack owner can restore a release.";
          if (args.baseRevision !== revisions.head) throw {code:"stale_base",message:"Review the latest release."};
          if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision >= args.baseRevision ||
              !revisions.manifests[args.sourceRevision] || !args.requestId) throw "This restore needs an earlier release and its review.";
          if (args.required && !args.releaseNote.trim()) throw "Add a reason for requiring this update.";
          const revision = ++revisions.head;
          revisions.restores.push(args);
          if (args.required) revisions.floor = revision;
          revisions.notes[revision] = args.releaseNote;
          revisions.manifests[revision] = structuredClone(revisions.manifests[args.sourceRevision]);
          const release = {revision,code:"PNHLW234",playerUrl,releaseNote:args.releaseNote,required:args.required,
            minimumPlayableRevision:revisions.floor};
          localStorage.setItem("test-pack:" + args.instanceId, JSON.stringify(release));
          return release;
        }
        case "get_pack_channel_state": {
          if (window.packServiceOffline) {
            throw new Error("Service unavailable");
          }
          return args.instanceId === "2" ? {
            instanceId: "2", revision: 4, latestRevision: 4, role: "owner", updateAvailable: false,
          } : null;
        }
        case "list_instance_content": {
          if (args.instanceId !== "1" && args.instanceId !== editId) return [];
          if (window.resourceFolderUnavailable && args.category === "resourcepacks") {
            throw new Error("Folder unavailable");
          }
          if (args.category === "mods" && window.packReadGate) await window.packReadGate;
          return inventory(args.category);
        }
        case "resolve_pack_mod_conflict": {
          const state = window.compatibility;
          state.resolveRequests.push(args);
          if (state.mode !== "resolution" || state.keptVersion || args.instanceId !== "1" || args.modId !== "ferritecore" ||
              !duplicateVersions.some(item => item.fileName === args.keepFileName) ||
              args.candidates.length !== duplicateVersions.length ||
              !duplicateVersions.every(item => args.candidates.some(candidate =>
                candidate.fileName === item.fileName && candidate.sha512 === item.sha512))) {
            throw new Error("The enabled mod files changed. Check again.");
          }
          if (state.resolveError) throw state.resolveError;
          if (state.mutationGate) await state.mutationGate;
          state.keptVersion = args.keepFileName;
          return;
        }
        case "review_pack_dependencies": {
          const state = window.compatibility;
          state.dependencyReviews.push(args);
          if (state.dependenciesBlocked) return {
            reviewToken: null, actions: [], issues: ["Two mods require different Fabric API versions."],
          };
          if (state.dependenciesApplied && state.dependenciesPartial) return {
            reviewToken: null, actions: [], issues: ["One required mod has no compatible Fabric version."],
          };
          return { reviewToken: "dependency-review", actions: dependencyActions, issues: state.dependenciesPartial
            ? ["One required mod has no compatible Fabric version."] : [] };
        }
        case "apply_pack_dependencies": {
          const state = window.compatibility;
          state.dependencyApplies.push(args);
          if (args.reviewToken !== "dependency-review" || args.instanceId !== "1" || state.dependenciesBlocked) {
            throw new Error("The dependency plan changed.");
          }
          if (state.mutationGate) await state.mutationGate;
          state.dependenciesApplied = true;
          return null;
        }
        case "preview_pack_publication":
        case "check_pack_compatibility": {
          const { mode, gate, requests, selectionRequests, keptVersion } = window.compatibility;
          requests.push(args.instanceId);
          if (mode === "resolution") selectionRequests.push(args.excludedLocalFiles ?? []);
          if (gate) await gate;
          if (mode === "offline") throw new Error("Couldn’t reach Modrinth. Check your connection and try again.");
          const dependenciesMissing = mode === "dependencies" && !window.compatibility.dependenciesApplied;
          const dependenciesStillBlocked = mode === "dependencies" && window.compatibility.dependenciesApplied &&
            window.compatibility.dependenciesPartial;
          const excludedLocalFiles = [];
          const files = Object.keys(contents).flatMap(category => inventory(category).map(item => {
            let state = "verified";
            let message = "Exact file verified on Modrinth · " + item.version;
            let canKeepLocal = false;
            let duplicateGroup = null;
            if (mode === "managed") {
              state = "managed";
              message = "Delight supplies this cosmetic separately on each installation.";
            } else if (mode === "mixed" && item.enabled) {
              state = "issue";
              message = "Modrinth has no source for this exact file. Install a matching catalog release and recheck.";
            } else if (mode === "resolution" && !keptVersion && duplicateVersions.some(mod => mod.fileName === item.fileName)) {
              state = "issue";
              duplicateGroup = "ferritecore";
              message = "More than one enabled file declares this Fabric mod.";
            } else if (mode === "resolution" && item.fileName === customMod.fileName) {
              canKeepLocal = true;
              const local = { fileName: item.fileName, sha512: item.sha512 };
              const selected = command === "preview_pack_publication" || args.excludedLocalFiles?.some(choice => choice.fileName === local.fileName && choice.sha512 === local.sha512);
              state = selected ? "localOnly" : "issue";
              message = selected ? "This file stays on this instance. Followers won’t receive it." : "Modrinth has no match for this exact file.";
              if (selected) excludedLocalFiles.push(local);
            } else if (dependenciesMissing && ["FerriteCore", "Stonework"].includes(item.name)) {
              state = "issue";
              message = "Requires Fabric API.";
            } else if (dependenciesStillBlocked && item.name === "Stonework") {
              state = "issue";
              message = "One required mod has no compatible Fabric version.";
            }
            return {
              category, fileName: item.fileName, size: item.size, enabled: item.enabled,
              state, message, canKeepLocal, duplicateGroup, sha512: item.sha512 || "a".repeat(128),
              projectId: state === "verified" ? "project-" + item.name.toLowerCase() : null,
              versionId: state === "verified" ? releaseIds[item.name] : null,
            };
          }));
          if (mode === "changed") files[0].size += 1;
          return window.compatibility.latest = {
            instanceId: args.instanceId, name: instances.find(instance => instance.id === args.instanceId)?.name,
            minecraftVersion: "1.21.1", loader: "Fabric", loaderVersion: "0.16.10",
            reviewToken: files.some(file => file.state === "issue") || mode === "unsupported" ? null : "review-" + requests.length,
            files, excludedLocalFiles, excludedFolders: mode === "folders" ? ["config", "scripts"] : [],
            missingDependencies: dependenciesMissing ? missingDependencies : dependenciesStillBlocked
              ? [{ projectId: "unavailable", versionId: null, requiredBy: ["stonework.zip"] }] : [],
            issues: mode === "unsupported" ? [
              "Select a Fabric Loader version in instance settings or launch the instance once, then recheck.",
            ] : [],
          };
        }
        case "reconcile_cosmetics":
        case "list_instance_folders":
        case "list_instance_worlds":
        case "list_managed_java_runtimes":
        case "list_pack_channel_memberships":
        case "list_cached_screenshots":
        case "detect_java_installations": return [];
        case "list_portal": return { entries: [], warnings: [] };
        case "cosmetics_request": return { items: [] };
        case "get_client_cache_settings": return { enabled: true, maxBytes: 3e9 };
        case "plugin:app|version": return "test";
        case "plugin:event|listen": events.set(args.event, args.handler); return next++;
        default: return null;
      }
    },
  };
}

async function checkCreatorUpdates(theme, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, {theme, revisions: true});
  const nav = page.getByRole("navigation", {name: "Pack Workspace pages"});
  const navButton = name => nav.getByRole("button", {name, exact: true});
  const changeList = page.getByRole("list", {name: "Unpublished changes"});
  const publish = version => page.getByRole("button", {name: "Publish version " + version, exact: true});
  const switchTo = async name => {
    await page.getByRole("button", {name: /^Switch workspace instance:/}).click();
    await page.getByRole("dialog", {name: /^Switch workspace instance:/}).getByRole("button", {name: new RegExp("^" + name)}).last().click();
  };
  const verifyConnector = async count => {
    assert.equal(await nav.getByRole("listitem").count(), count);
    const geometry = await nav.evaluate(el => {
      const icon = el.querySelector(".pack-workspace-group svg").getBoundingClientRect();
      const group = el.querySelector("ul");
      const last = group.lastElementChild.getBoundingClientRect();
      const bounds = group.getBoundingClientRect();
      const line = getComputedStyle(group, "::before");
      return {
        iconX: icon.x + icon.width / 2, x: bounds.x + parseFloat(line.left),
        y: bounds.bottom - parseFloat(line.bottom), lastY: last.y + last.height / 2,
        left: line.borderLeftStyle, bottom: line.borderBottomStyle, corner: parseFloat(line.borderBottomLeftRadius),
        childSize: parseFloat(getComputedStyle(group.querySelector("button")).fontSize),
        parentSize: parseFloat(getComputedStyle(el.querySelector(".pack-workspace-group")).fontSize),
      };
    });
    assert.ok(Math.abs(geometry.iconX - geometry.x) <= 1, "The line begins beneath the parent icon");
    assert.ok(Math.abs(geometry.y - geometry.lastY) <= 1, "The hook ends at the center of the final child");
    assert.ok(geometry.left === "solid" && geometry.bottom === "solid" && geometry.corner > 0);
    assert.ok(geometry.childSize < geometry.parentSize);
  };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", {name: "Main navigation"}).getByRole("button", {name: "Instances", exact: true}).click();
    await page.getByRole("button", {name: "Actions for Pine Hollow", exact: true}).click();
    await page.getByRole("button", {name: "Open Pack Workspace", exact: true}).click();
    await navButton("Changes").waitFor();
    await verifyConnector(5);
    const parent = navButton("Sharing");
    await parent.press("Space");
    assert.equal(await parent.getAttribute("aria-expanded"), "false");
    assert.equal(await navButton("Changes").count(), 0);
    await parent.press("Enter");
    await navButton("Changes").click();
    await changeList.getByText("iris.jar (disabled)", {exact: true}).waitFor();
    assert.equal(await navButton("Changes").getAttribute("aria-current"), "page");
    const optional = page.getByRole("radio", {name: "Optional", exact: true});
    const required = page.getByRole("radio", {name: "Required before play", exact: true});
    assert.ok(await optional.isChecked());
    await required.check();
    const reason = page.getByRole("textbox", {name: "Reason for required update"});
    await page.getByRole("checkbox", {name: /agree to the Delight Terms/}).check();
    assert.ok(await publish(2).isDisabled());
    await reason.fill("The server now requires this resource pack.");
    await navButton("Releases").click();
    const history = page.getByRole("region", {name: "Release history"});
    await history.getByText("Version 1").waitFor();
    await page.evaluate(() => { window.publicationTest.publisher = {id: "visitor", name: "Visitor", termsAccepted: true}; });
    await navButton("Changes").click();
    await page.getByRole("button", {name: "Sign in as publisher"}).waitFor();
    assert.equal(await publish(2).count(), 0);
    await navButton("Releases").click();
    await page.evaluate(() => { window.publicationTest.publisher = {id: "river", name: "River", termsAccepted: false}; });
    await navButton("Changes").click();
    assert.equal(await reason.inputValue(), "The server now requires this resource pack.");
    assert.ok(await required.isChecked());
    await page.getByRole("checkbox", {name: /agree to the Delight Terms/}).check();
    await publish(2).click();
    await history.getByText("Version 2").waitFor();
    assert.equal(await navButton("Releases").getAttribute("aria-current"), "page");
    await history.getByText("Required", {exact: true}).waitFor();
    await history.getByText("The server now requires this resource pack.").waitFor();

    await navButton("Changes").click();
    await page.getByText("No content changes.", {exact: true}).waitFor();
    assert.ok(await optional.isChecked());
    assert.ok(await publish(3).isDisabled());
    const note = page.getByRole("textbox", {name: /Release note/});
    await note.fill("A server announcement for this release.");
    // A different publisher advances the service head while this review is open.
    await page.evaluate(() => {
      const state = window.revisionTest;
      state.head = 3;
      state.manifests[3] = structuredClone(state.manifests[2]);
      state.notes[3] = "Server configuration updated.";
    });
    await publish(3).click();
    await page.getByRole("button", {name: "Review latest version"}).click();
    await publish(4).waitFor();
    assert.equal(await note.inputValue(), "A server announcement for this release.");
    await note.fill("New optional release notes.");
    await publish(4).click();
    await history.getByText("Version 4").waitFor();
    assert.equal(await page.evaluate(() => window.revisionTest.floor), 2);
    assert.deepEqual(await page.evaluate(() => window.publicationTest.requests.map(r => [r.baseRevision, r.required])), [[1,true],[2,false],[3,false]]);

    await switchTo("Pine Hollow \\(2\\)");
    await page.getByRole("region", {name: "Followed pack releases"}).waitFor();
    assert.equal(await navButton("Changes").count(), 0);
    await verifyConnector(2);
    await switchTo("Skyblock");
    await page.getByText("Shared pack · Version 4").waitFor();
    assert.equal(await navButton("Overview").getAttribute("aria-current"), "page");
    await verifyConnector(1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function checkDraftReview() {
  const page = await browser.newPage({viewport:{width:900,height:680}, reducedMotion:"reduce"});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const avatarUrl = "https://avatars.githubusercontent.com/u/42";
  await page.route("**/*", route => {
    if (route.request().url() === avatarUrl) {
      return route.fulfill({contentType:"image/svg+xml", body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#83a3eb"/></svg>'});
    }
    return new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort();
  });
  await page.addInitScript(initializeLibrary, {theme:"light", revisions:true, drafts:true, draftAvatarUrl:avatarUrl});
  const button = name => page.getByRole("button", {name,exact:true});
  const nav = page.getByRole("navigation",{name:"Pack Workspace pages"});
  const section = name => nav.getByRole("button",{name,exact:true});
  const checkNoteStyle = field => field.evaluate(element => {
    const style = getComputedStyle(element);
    return {compact:element.offsetHeight <= 64, radius:style.borderRadius, launcherFont:style.fontFamily !== "monospace"};
  });
  const switchInstance = async label => {
    await page.getByRole("button",{name:/^Switch workspace instance:/}).click();
    await page.getByRole("dialog",{name:/^Switch workspace instance:/}).getByRole("button",{name:label}).click();
  };
  const verifyDraftIdentity = async (container, withProfile) => {
    const identity = container.locator(".workspace-draft-identity");
    const avatar = identity.locator(":scope > .workspace-draft-avatar:first-child");
    const title = identity.locator(".workspace-draft-copy > strong");
    const byline = identity.getByText("By Lake",{exact:true});
    await byline.waitFor();
    if (withProfile) {
      const image = avatar.locator("img");
      assert.equal(await image.getAttribute("src"),avatarUrl);
      await image.evaluate(element => element.decode());
    } else {
      assert.equal(await avatar.locator("img").count(),0);
      assert.equal(await avatar.innerText(),"L");
    }
    const [avatarBounds, titleBounds, bylineBounds] = await Promise.all([avatar.boundingBox(), title.boundingBox(), byline.boundingBox()]);
    assert.ok(avatarBounds && titleBounds && bylineBounds);
    assert.ok(avatarBounds.x + avatarBounds.width < Math.min(titleBounds.x, bylineBounds.x),
      "The profile picture leads the draft title and author line");
    assert.ok(titleBounds.y + titleBounds.height <= bylineBounds.y, "The author line sits below the title");
    assert.equal(avatarBounds.width,34);
    assert.equal(avatarBounds.height,34);
  };
  try {
    await page.goto(url,{waitUntil:"domcontentloaded"});
    await page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Instances",exact:true}).click();
    await button("Actions for Pine Hollow").click();
    await button("Open Pack Workspace").click();
    await section("Review").click();
    const ownerTabs = page.getByRole("tablist",{name:"Review status"});
    assert.deepEqual(await ownerTabs.getByRole("tab").allTextContents(),["In review","Published"]);
    await ownerTabs.getByRole("tab",{name:"In review"}).press("ArrowRight");
    await page.getByRole("tabpanel",{name:"Published"}).getByText("No published drafts yet.").waitFor();
    await ownerTabs.getByRole("tab",{name:"Published"}).press("Home");
    await page.getByText("No submissions yet.",{exact:true}).waitFor();
    await switchInstance(/^Pine Hollow \(Working copy\)/);
    await section("Changes").click();
    const draftNote = page.getByRole("textbox",{name:/Draft note/});
    await draftNote.fill("Add optional shaders.");
    const save = button("Save draft");
    assert.equal(await save.evaluate(element => !!element.closest(".instance-hero-actions") && element.classList.contains("ceramic-action")),true);
    assert.equal(await button("Merge & publish").count(),0);
    await save.click();
    const diff = page.getByRole("table",{name:"Draft changes"});
    assert.deepEqual(await diff.getByRole("columnheader").allTextContents(),["Added","Removed"]);
    await diff.locator("td[data-diff=added]").getByText("iris.jar (disabled)",{exact:true}).waitFor();
    await diff.locator("td[data-diff=removed]").getByText("Stonework.zip (disabled)",{exact:true}).waitFor();
    await page.getByText("To River",{exact:true}).waitFor();
    await switchInstance(/^Pine Hollow 1\.21/);
    await section("Review").click();
    await page.getByText("No submissions yet.",{exact:true}).waitFor();
    await switchInstance(/^Pine Hollow \(Working copy\)/);
    await section("Drafts").click();
    const editorTabs = page.getByRole("tablist",{name:"Draft status"});
    assert.deepEqual(await editorTabs.getByRole("tab").allTextContents(),["Drafts","In review","Changes requested","Published"]);
    await page.getByRole("list",{name:"Drafts",exact:true}).getByRole("button",{name:/Add optional shaders/}).click();
    await button("Send to owner").click();
    await page.getByRole("region",{name:"Saved draft"}).getByText("In review",{exact:true}).waitFor();
    await page.getByText("Sent to River",{exact:true}).waitFor();

    await switchInstance(/^Pine Hollow 1\.21/);
    await section("Review").click();
    const submission = page.getByRole("list",{name:"Submissions"}).getByRole("button",{name:/Add optional shaders.*By Lake/});
    await verifyDraftIdentity(submission,true);
    await submission.click();
    await verifyDraftIdentity(page.getByRole("region",{name:"Review submission"}),true);
    await page.getByRole("heading",{name:"Changes to main pack"}).waitFor();
    assert.deepEqual(await checkNoteStyle(page.getByRole("textbox",{name:"Release note",exact:true})),
      {compact:true, radius:"7px", launcherFont:true});
    await button("Return to editor").click();
    const feedback = page.getByRole("textbox",{name:"Review feedback"});
    assert.deepEqual(await checkNoteStyle(feedback), {compact:true, radius:"7px", launcherFont:true});
    await feedback.fill("Please explain how to enable Iris.");
    await button("Send feedback").click();
    await page.getByText("No submissions yet.",{exact:true}).waitFor();

    await switchInstance(/^Pine Hollow \(Working copy\)/);
    await section("Drafts").click();
    await editorTabs.getByRole("tab",{name:"Changes requested"}).click();
    await page.getByRole("list",{name:"Changes requested"}).getByRole("button",{name:/Add optional shaders/}).click();
    await page.getByText("Please explain how to enable Iris.",{exact:true}).waitFor();
    await button("Edit draft").click();
    await page.evaluate(() => { window.draftAuthorAvatarUrl = null; });
    await draftNote.fill("Iris is included and disabled by default.");
    await save.click();
    await button("Send to owner").click();
    await page.getByRole("region",{name:"Saved draft"}).getByText("In review",{exact:true}).waitFor();

    await switchInstance(/^Pine Hollow 1\.21/);
    await section("Review").click();
    const revisedSubmission = page.getByRole("list",{name:"Submissions"}).getByRole("button",{name:/Lake/});
    await verifyDraftIdentity(revisedSubmission,false);
    await revisedSubmission.click();
    await verifyDraftIdentity(page.getByRole("region",{name:"Review submission"}),false);
    await page.getByRole("radio",{name:"Required before play"}).check();
    const ownerNote = page.getByRole("textbox",{name:"Reason for required update"});
    await ownerNote.fill("");
    await page.getByRole("checkbox",{name:/agree to the Delight/}).check();
    assert.ok(await button("Merge & publish").isDisabled());
    await ownerNote.fill("Required for our server.");
    await button("Merge & publish").click();
    await page.getByText("Published · Version 2").waitFor();
    await page.getByRole("tabpanel",{name:"Published"}).waitFor();
    await section("Releases").click();
    await page.getByRole("region",{name:"Release history"}).getByText("Required for our server.").waitFor();
    assert.equal(await page.evaluate(() => window.revisionTest.head),2);
    await section("Review").click();
    await ownerTabs.getByRole("tab",{name:"Published"}).click();
    await page.getByRole("tabpanel",{name:"Published"}).getByRole("button",{name:/By Lake/}).click();
    await page.getByText("Published · Version 2").waitFor();
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
}

async function checkAccess(theme, viewport) {
  const page = await browser.newPage({viewport, reducedMotion:"reduce"});
  page.setDefaultTimeout(10000);
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, {theme, revisions:true});
  const nav = page.getByRole("navigation", {name:"Pack Workspace pages"});
  const button = name => page.getByRole("button", {name, exact:true});
  const triggerAlignment = async (control, label) => {
    const layout = await control.evaluate((element, name) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() === name) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          text = range.getBoundingClientRect();
          break;
        }
      }
      const centerY = bounds => bounds.top + bounds.height / 2;
      const bounds = element.getBoundingClientRect();
      const [chevron, ...extraIcons] = element.querySelectorAll("svg");
      return {
        labelY: text && Math.abs(centerY(text) - centerY(bounds)),
        labelX: text && Math.abs(text.left + text.width / 2 - (bounds.left + bounds.width / 2)),
        standardChevron: chevron?.matches(".lucide-chevron-down"),
        chevronY: chevron && Math.abs(centerY(chevron.getBoundingClientRect()) - centerY(bounds)),
        extraIcons: extraIcons.length,
      };
    }, label);
    assert.ok(layout.labelX <= 2 && layout.labelY <= 2, label + " is centered in the trigger");
    assert.ok(layout.standardChevron && layout.chevronY <= 2, "The launcher chevron is vertically centered");
    assert.equal(layout.extraIcons, 0, "The launcher chevron is the only trigger icon");
  };
  try {
    await page.goto(url, {waitUntil:"domcontentloaded"});
    await page.getByRole("navigation", {name:"Main navigation"}).getByRole("button", {name:"Instances",exact:true}).click();
    await button("Actions for Pine Hollow").click();
    const instanceMenu = page.getByRole("dialog", {name:"Actions for Pine Hollow",exact:true});
    await instanceMenu.waitFor();
    assert.equal(await instanceMenu.getByRole("button", {name:"Share instance",exact:true}).count(), 0,
      "Pack Workspace is the sharing entry point");
    await button("Open Pack Workspace").click();
    const copyPlayerLink = button("Copy player link");
    await copyPlayerLink.waitFor();
    const standardHeaderAction = await copyPlayerLink.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const paint = getComputedStyle(element);
      return {right:rect.right, top:rect.top, height:rect.height, shadow:paint.boxShadow, background:paint.backgroundImage};
    });
    await nav.getByRole("button", {name:"Access",exact:true}).click();
    const createLink = button("Create link");
    await createLink.waitFor();
    assert.ok(await createLink.evaluate(element => element.closest(".instance-hero-actions") && element.form?.matches(".workspace-link-form")));
    assert.deepEqual(await createLink.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const paint = getComputedStyle(element);
      return {right:rect.right, top:rect.top, height:rect.height, shadow:paint.boxShadow, background:paint.backgroundImage};
    }), standardHeaderAction, "Create link matches the shared ceramic action's header position, height and finish");
    assert.notEqual(standardHeaderAction.shadow, "none");

    const access = name => page.getByRole("main").getByRole("button", {name:"Access: " + name,exact:true});
    const role = access("View");
    assert.ok(await role.evaluate(element => element.matches(".select-trigger")));
    await triggerAlignment(role, "View");
    await role.press("ArrowDown");
    const picker = page.getByRole("dialog", {name:"Access: View",exact:true});
    const view = picker.getByRole("button", {name:"View",exact:true});
    const edit = picker.getByRole("button", {name:"Edit",exact:true});
    await view.and(page.locator(":focus")).waitFor();
    assert.equal(await view.getAttribute("aria-pressed"), "true");
    assert.equal(await picker.locator("svg").count(), 0, "Role options use text and the selected-row highlight");
    await view.press("Escape");
    await picker.waitFor({state:"hidden"});
    await role.and(page.locator(":focus")).waitFor();
    await role.click();
    await edit.click();
    await triggerAlignment(access("Edit"), "Edit");
    assert.equal(await page.getByRole("spinbutton",{name:"Expires in (hours)"}).inputValue(), "24");
    assert.equal(await page.getByRole("spinbutton",{name:"Use limit"}).inputValue(), "1");
    const field = page.getByRole("textbox", {name:"New invitation link"});
    const useLimit = page.getByRole("spinbutton",{name:"Use limit"});
    await useLimit.fill("0");
    await createLink.click();
    assert.equal(await field.count(), 0, "Create link keeps the form's limit validation");
    await useLimit.fill("3");
    await createLink.click();
    await field.waitFor();
    const invitation = await field.inputValue();
    await button("Copy link").click();
    assert.equal(await page.evaluate(() => window.publicationTest.clipboard), invitation);
    await page.getByText(/0 of 3 used/).waitFor();
    const playerLink = page.getByRole("region", {name:"Player link",exact:true});
    await playerLink.getByText("New installs allowed", {exact:true}).waitFor();
    await playerLink.getByRole("button", {name:"Pause sharing",exact:true}).click();
    await playerLink.getByText("New installs paused", {exact:true}).waitFor();
    assert.ok(await createLink.isDisabled());
    assert.ok(await access("Edit").isDisabled());
    assert.ok(await page.getByRole("spinbutton",{name:"Expires in (hours)"}).isDisabled());
    assert.ok(await useLimit.isDisabled());
    await nav.getByRole("button", {name:"Overview",exact:true}).click();
    await nav.getByRole("button", {name:"Access",exact:true}).click();
    await playerLink.getByText("New installs paused", {exact:true}).waitFor();
    const permission = page.getByRole("checkbox", {name:"Can publish · Lake"});
    await permission.check();
    assert.ok(await permission.isChecked(), "Existing collaborator settings can change while sharing is paused");
    await playerLink.getByRole("button", {name:"Resume sharing",exact:true}).click();
    await playerLink.getByText("New installs allowed", {exact:true}).waitFor();
    await page.waitForFunction(() => {
      const trigger = document.querySelector(".workspace-role-field .select-trigger");
      return trigger && !trigger.disabled;
    });
    assert.ok(await createLink.isEnabled());
    assert.deepEqual(await page.evaluate(() => window.sharingChanges), [
      {instanceId:"1", enabled:false}, {instanceId:"1", enabled:true},
    ]);
    await button("Revoke link").click();
    await page.getByText(/Revoked · 0 of 3 used/).waitFor();
    await button("Remove Lake").click();
    await button("Remove access").click();
    await page.getByText("No collaborators yet.").waitFor();
    await page.getByRole("menuitem", {name:"File",exact:true}).click();
    await page.getByRole("menuitem", {name:"Open invite link",exact:true}).click();
    await page.getByRole("textbox",{name:"Invite link",exact:true}).fill(invitation);
    await button("Preview invite").click();
    await page.getByText(/River · Editor invitation/).waitFor();
    await button("Accept invite").click();
    await button("Open working copy").click();
    await page.getByRole("heading",{name:"Pine Hollow (Working copy)"}).waitFor();
    await nav.getByRole("button",{name:"Changes",exact:true}).and(page.locator('[aria-current="page"]')).waitFor();
    assert.equal(await nav.getByRole("button",{name:"Access",exact:true}).count(),0);
  } finally { await page.close(); }
}

async function checkNavigation(theme, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, theme);
  const screenshot = async name => {
    if (screenshots) await page.screenshot({ path: join(screenshots, theme + "-" + name + ".png") });
  };
  const instances = page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Instances", exact: true });
  const more = page.getByRole("button", { name: "Actions for Pine Hollow", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true });
  const switcher = name => page.getByRole("button", { name: "Switch workspace instance: " + name, exact: true });
  const openWorkspace = async (captureMenu = false) => {
    await more.click();
    if (captureMenu) await screenshot("menu");
    await page.getByRole("button", { name: "Open Pack Workspace", exact: true }).click();
    const panel = page.locator("main[data-desktop-page='pack-workspace']");
    await panel.getByText("Pack Workspace", { exact: true }).waitFor();
    await panel.getByRole("heading", { level: 1, name: "Pine Hollow", exact: true }).waitFor();
  };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await instances.click();
    const libraryMod = page.locator(".installed-content-item").filter({ has: page.getByText("FerriteCore", { exact: true }) });
    await libraryMod.waitFor();
    const rowIdentity = row => row.locator(".content-detail-hitarea").evaluate(element => ({
      title: element.querySelector(".content-name b").textContent,
      file: element.querySelector(".content-name b").title,
      metadata: [...element.querySelectorAll(".content-metadata span")].map(field => field.textContent),
      iconWidth: element.querySelector(".content-icon").getBoundingClientRect().width,
      font: getComputedStyle(element.querySelector(".content-name b")).font,
    }));
    const libraryIdentity = await rowIdentity(libraryMod);
    const shaders = page.getByRole("tab", { name: "Shaders", exact: true });
    await shaders.click();
    await screenshot("instance");
    await openWorkspace(true);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.equal(await instances.getAttribute("aria-current"), "page");
    assert.equal(await back.evaluate(button => getComputedStyle(button).borderTopStyle), "dashed");
    const layout = await back.evaluate(button => {
      const labels = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.textContent.trim() === "Back" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
      });
      const range = document.createRange();
      range.selectNodeContents(labels.nextNode());
      const bounds = button.getBoundingClientRect();
      const text = range.getBoundingClientRect();
      return {
        centerOffset: (text.left + text.width / 2) - (bounds.left + bounds.width / 2),
        arrowBeforeLabel: button.querySelector("svg").getBoundingClientRect().right < text.left,
      };
    });
    assert.ok(Math.abs(layout.centerOffset) < 2, "Back label is centered across the full button");
    assert.ok(layout.arrowBeforeLabel, "Arrow is on the left");
    assert.equal(await switcher("Pine Hollow").locator("img").count(), 1);
    const create = page.getByRole("button", { name: "Create shared pack", exact: true });
    const review = page.getByRole("region", { name: "Pack contents review", exact: true });
    const release = page.getByRole("region", { name: "First release", exact: true });
    const backToOverview = page.getByRole("button", { name: "Back to overview", exact: true });
    await create.waitFor();
    await screenshot("workspace");

    await create.press("Enter");
    await release.getByRole("heading", { name: "First release", exact: true }).and(page.locator(":focus")).waitFor();
    assert.equal(await page.getByRole("button", { name: "Review first release" }).count(), 0);
    assert.equal(await backToOverview.count(), 1);
    assert.match(await release.innerText(), /1\.21\.1/);
    assert.match(await release.innerText(), /0\.16\.10/);
    assert.equal(await release.getByText("FerriteCore", { exact: true }).isVisible(), false);
    await release.getByText("Files", { exact: true }).click();
    const releaseMod = release.locator(".installed-content-item").filter({ has: page.getByText("FerriteCore", { exact: true }) });
    await releaseMod.waitFor();
    assert.deepEqual(await rowIdentity(releaseMod), libraryIdentity);
    assert.equal(await releaseMod.locator("button").count(), 0);
    await releaseMod.getByRole("img", { name: "Enabled", exact: true }).waitFor();
    await release.getByRole("img", { name: "Disabled", exact: true }).waitFor();
    const checkCount = () => page.evaluate(() => window.compatibility.requests.length);
    const mods = page.getByRole("tab", { name: "Mods", exact: true });
    const resources = page.getByRole("tab", { name: "Resource packs", exact: true });
    const reviewMod = page.getByRole("tabpanel").locator(".installed-content-item")
      .filter({ has: page.getByText("FerriteCore", { exact: true }) });
    await screenshot("first-release");
    await backToOverview.click();
    await create.and(page.locator(":focus")).waitFor();

    const setCheck = mode => page.evaluate(value => { window.compatibility.mode = value; }, mode);
    const initialChecks = await checkCount();
    await setCheck("mixed");
    await create.click();
    const checkAgain = page.getByRole("button", { name: "Check again", exact: true });
    await checkAgain.waitFor();
    assert.ok(await checkCount() > initialChecks, "Reopening the inventory checks its current files");
    assert.equal(await release.count(), 0, "An unmatched enabled file blocks release review");
    await reviewMod.getByRole("img", { name: "Needs attention", exact: true }).waitFor();
    await page.getByRole("tabpanel").getByText(/Modrinth has no source for this exact file/).waitFor();
    await screenshot("compatibility-issues");
    await page.getByRole("button", { name: "Show issues in Resource packs", exact: true }).press("Enter");
    assert.equal(await resources.getAttribute("aria-selected"), "true");
    await page.getByRole("tabpanel").getByText("Stonework", { exact: true }).waitFor();
    const resourceIssue = page.getByRole("tabpanel").getByText(/Modrinth has no source for this exact file/);
    await resourceIssue.waitFor();
    assert.ok(await resourceIssue.evaluate(node => document.activeElement.contains(node)),
      "Keyboard navigation lands on the issue itself");

    await setCheck("unsupported");
    await checkAgain.click();
    await review.getByText(/Select a Fabric Loader version in instance settings/).waitFor();
    assert.equal(await release.count(), 0, "Verified files cannot clear an instance-level issue");
    await setCheck("offline");
    await checkAgain.click();
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await retry.waitFor();
    assert.equal(await release.count(), 0, "A failed provider call cannot produce a ready state");
    await setCheck("changed");
    const previousChecks = await checkCount();
    await retry.click();
    await page.waitForFunction(before => window.compatibility.requests.length > before, previousChecks);
    await review.getByRole("alert").filter({ hasText: /files changed during the check/ }).waitFor();
    await retry.waitFor();
    assert.equal(await release.count(), 0, "Differing inventory and preflight snapshots need rechecking");
    await setCheck("folders");
    await retry.click();
    await release.getByText("Stays on this device", { exact: true }).waitFor();
    assert.match(await release.innerText(), /config, scripts/);
    assert.equal(await page.getByRole("checkbox", { name: "Leave these folders out" }).count(), 0);
    await screenshot("release-exclusions");
    await backToOverview.click();
    await setCheck("managed");
    await create.click();
    await release.waitFor();
    assert.equal(await release.getByText("Stays on this device", { exact: true }).count(), 0);
    await backToOverview.click();
    await setCheck("ready");

    const trigger = switcher("Pine Hollow");
    const dialog = page.getByRole("dialog", { name: "Switch workspace instance: Pine Hollow" });
    const sidebar = page.locator(".desktop-context");
    const overview = sidebar.getByText("Overview", { exact: true });
    const tabBefore = await overview.boundingBox();
    await trigger.press("ArrowDown");
    await dialog.waitFor();
    const menuBox = await dialog.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    const triggerBox = await trigger.boundingBox();
    const leftMidpoint = (sidebarBox.x + triggerBox.x) / 2;
    const rightMidpoint = (sidebarBox.x + sidebarBox.width + triggerBox.x + triggerBox.width) / 2;
    assert.ok(Math.abs(menuBox.x - leftMidpoint) < 1, "Menu starts halfway between sidebar and trigger left edges");
    assert.ok(Math.abs(menuBox.x + menuBox.width - rightMidpoint) < 1, "Menu ends halfway between sidebar and trigger right edges");
    assert.ok(menuBox.y >= triggerBox.y + triggerBox.height - 1, "Menu opens below the trigger");
    assert.deepEqual(await overview.boundingBox(), tabBefore, "Opening the menu preserves tab placement");
    const overlayCoversTab = await dialog.evaluate((menu, tab) =>
      menu.contains(document.elementFromPoint(tab.x + tab.width / 2, tab.y + tab.height / 2)), tabBefore);
    assert.ok(overlayCoversTab, "The open menu covers the Overview tab");
    assert.equal(await dialog.locator(".lucide-check:visible").count(), 0, "No selection checkmark is visible");
    assert.equal(await dialog.getByRole("button", { name: /Pine Hollow/ }).getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await trigger.evaluate(el => el === document.activeElement));

    await trigger.press("ArrowDown");
    const current = dialog.getByRole("button", { name: /Pine Hollow/ });
    const next = dialog.getByRole("button", { name: /Skyblock/ });
    await current.and(page.locator(":focus")).waitFor();
    await page.keyboard.press("ArrowDown");
    await next.and(page.locator(":focus")).waitFor();
    await screenshot("switcher");
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Skyblock", exact: true }).waitFor();
    await page.getByText("Shared pack · Version 4", { exact: true }).waitFor();
    assert.equal(await create.count(), 0, "Shared instances have no Create action");
    await switcher("Skyblock").waitFor();
    await switcher("Skyblock").click();
    const switchedMenu = page.getByRole("dialog", { name: "Switch workspace instance: Skyblock" });
    assert.equal(await switchedMenu.getByRole("button", { name: /Skyblock/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await switchedMenu.getByRole("button", { name: /Pine Hollow/ }).getAttribute("aria-pressed"), "false");
    await page.keyboard.press("Escape");
    assert.equal(await instances.getAttribute("aria-current"), "page");
    await back.press("Enter");
    await more.and(page.locator(":focus")).waitFor();
    assert.equal(await shaders.getAttribute("aria-selected"), "true");
    assert.equal(await instances.getAttribute("aria-current"), "page");

    // Worlds has its own visibility state separate from the content tab.
    const worlds = page.getByRole("tab", { name: "Worlds", exact: true });
    await worlds.click();
    await page.evaluate(() => { window.packServiceOffline = true; });
    await openWorkspace();
    await switcher("Pine Hollow").waitFor();
    await page.getByRole("alert").filter({ hasText: /whether this instance is shared/i }).waitFor();
    await screenshot("overview-read-error");
    assert.equal(await create.count(), 0, "A failed status lookup never exposes Create");
    await page.evaluate(() => { window.packServiceOffline = false; });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.evaluate(() => { window.resourceFolderUnavailable = true; });
    await create.click();
    await page.getByRole("alert").filter({ hasText: /resource packs/i }).waitFor();
    await screenshot("contents-read-error");
    await page.evaluate(() => { window.resourceFolderUnavailable = false; });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await release.waitFor();
    await backToOverview.click();
    // An inventory response arriving after a switch must stay with the pack that requested it.
    await page.evaluate(() => {
      window.packReadGate = new Promise(resolve => { window.finishPackRead = resolve; });
      window.compatibility.gate = new Promise(resolve => { window.finishCheck = resolve; });
    });
    await create.click();
    await page.getByRole("status").filter({ hasText: "Reading instance files" }).waitFor();
    await screenshot("contents-reading");
    await page.evaluate(() => window.finishPackRead());
    await reviewMod.waitFor();
    await review.getByText("Checking sharing compatibility…", { exact: true }).waitFor();
    assert.equal(await release.count(), 0);
    await screenshot("compatibility-checking");
    await trigger.click();
    await dialog.getByRole("button", { name: /Skyblock/ }).click();
    await page.getByText("Shared pack · Version 4", { exact: true }).waitFor();
    await page.evaluate(() => window.finishCheck());
    assert.equal(await review.count(), 0);
    assert.equal(await release.count(), 0);
    assert.equal(await page.getByText("FerriteCore", { exact: true }).count(), 0);
    await back.click();
    assert.equal(await worlds.getAttribute("aria-selected"), "true");
    const writes = await page.evaluate(() => window.packCalls.filter(name =>
      ["create_pack_channel", "publish_pack_channel", "create_modpack_share"].includes(name)));
    assert.deepEqual(writes, [], "Previewing a pack leaves it unpublished");
    assert.deepEqual(await page.evaluate(() => [...new Set(window.compatibility.requests)]), ["1"],
      "Only the unshared instance being reviewed is checked");

    await openWorkspace();
    await setCheck("folders");
    await page.evaluate(() => { window.publicationTest.publisher = null; });
    await create.click();
    const publish = page.getByRole("button", { name: "Publish version 1", exact: true });
    await release.getByRole("button", { name: "Connect account", exact: true }).waitFor();
    assert.equal(await publish.count(), 0);
    await release.getByRole("button", { name: "Connect account", exact: true }).click();
    const consent = release.getByRole("checkbox", { name: /agree to the Delight Terms/ });
    const note = release.getByRole("textbox", { name: /release note/i });
    await publish.waitFor();
    assert.equal(await page.evaluate(() => window.publicationTest.openedUrl), "https://delight.example/approve");
    assert.ok(await publish.isEnabled(), "The account that already accepted the terms can publish immediately");
    assert.equal(await consent.count(), 0);
    // Switching the native account during review must refresh the actor and its own consent.
    await page.evaluate(() => { window.publicationTest.publisher = { id: "river", name: "River", termsAccepted: false }; });
    await publish.click();
    await consent.waitFor();
    assert.ok(await publish.isDisabled());
    assert.equal(await release.getByRole("link", { name: "Read terms" }).getAttribute("href"), "https://bloomclient.org/tos/");
    await note.fill("Our first community release.");
    await consent.check();
    await screenshot("publish-review");
    await page.evaluate(() => { window.publicationTest.error = { code: "stale_review", message: "These files changed. Review the contents again." }; });
    await publish.click();
    const recheck = page.getByRole("button", { name: "Recheck contents", exact: true });
    await recheck.waitFor();
    assert.ok(await publish.isDisabled());
    await recheck.click();
    await release.getByText("Stays on this device", { exact: true }).waitFor();
    assert.equal(await note.inputValue(), "Our first community release.");
    await consent.check();
    await page.evaluate(() => { window.publicationTest.error = { code: "publication_error", message: "Service unavailable. Try again." }; });
    await publish.click();
    await release.getByRole("alert").filter({hasText: "Service unavailable"}).waitFor();
    assert.ok(await publish.isEnabled());
    await page.evaluate(() => {
      delete window.publicationTest.error;
      window.publicationTest.gate = new Promise(resolve => { window.publicationTest.finish = resolve; });
    });
    await publish.click();
    assert.ok(await release.getByRole("button", { name: "Publishing…" }).isDisabled());
    assert.ok(await backToOverview.isDisabled());
    await page.evaluate(() => window.publicationTest.finish());
    const published = page.getByRole("region", { name: "Published release" });
    const link = published.getByRole("textbox", { name: "Player link" });
    const copy = page.getByRole("button", { name: "Copy player link", exact: true });
    await published.getByText("Version 1 published.", { exact: true }).waitFor();
    await copy.and(page.locator(":focus")).waitFor();
    assert.equal(await link.inputValue(), "https://delight.example/share/pack/PNHLW234");
    assert.equal(await create.count(), 0);
    const requests = await page.evaluate(() => window.publicationTest.requests);
    assert.equal(requests.length, 4);
    assert.deepEqual(requests.at(-1).excludedFolders, ["config", "scripts"]);
    assert.equal(requests.at(-1).publisherId, "river");
    assert.equal(requests.at(-1).releaseNote, "Our first community release.");
    assert.notEqual(requests[0].reviewToken, requests.at(-1).reviewToken);
    await screenshot("published-overview");
    await copy.click();
    await published.getByText("Player link copied.").waitFor();
    assert.equal(await page.evaluate(() => window.publicationTest.clipboard), await link.inputValue());
    await back.click();
    await openWorkspace();
    await published.getByText("Version 1", { exact: true }).waitFor();
    assert.equal(await link.inputValue(), "https://delight.example/share/pack/PNHLW234");
    await page.evaluate(() => { window.publicationTest.copyDenied = true; });
    await copy.click();
    await published.getByText(/context menu/).waitFor();
    assert.equal(await link.evaluate(el => el === document.activeElement && el.selectionEnd === el.value.length), true);
    assert.deepEqual(errors, []);
  } catch (error) {
    await screenshot("failure");
    console.error("Visible view:", await page.locator("main").innerText(), "Browser errors:", errors);
    throw error;
  } finally {
    await page.close();
  }
}

async function checkFollowerUpdates() {
  const page = await browser.newPage({viewport: {width: 1000, height: 700}, reducedMotion: "reduce"});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, {theme: "light", revisions: true});
  const button = name => page.getByRole("button", {name, exact: true});
  const releases = page.getByRole("region", {name: "Followed pack releases", exact: true});
  try {
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await page.getByRole("navigation", {name: "Main navigation"}).waitFor();
    await page.evaluate(() => {
      const test = window.revisionTest;
      test.head = 2; test.notes[2] = "Enable Stonework.";
      window.playerTest.queue.push("delight://pack/PNHLW234");
      window.playerTest.send("workspace-player-link", null);
    });
    await button("View update").click();
    await releases.getByText("Optional update", {exact: true}).waitFor();
    await releases.getByRole("list", {name: "Changes since installed version"}).getByText("Changed", {exact: true}).waitFor();
    assert.equal(await button("Play current version").count(), 0, "Opening a link does not request a game launch");
    assert.equal(await page.getByRole("navigation", {name:"Pack Workspace pages"}).getByRole("button",{name:"Changes",exact:true}).count(),0);
    await button("Back").click();
    await button("View update").click();
    await button("Play current version").click();
    await page.waitForFunction(() => window.revisionTest.launches.length === 1);
    assert.equal(await page.evaluate(() => window.revisionTest.installed), 1);

    await page.evaluate(() => {
      window.revisionTest.floor = 2;
      window.revisionTest.head = 3;
      window.revisionTest.repairNeeded = true;
      window.revisionTest.minecraftVersionChanged = true;
      window.revisionTest.notes[2] = "Server requires the new resource pack.";
      window.revisionTest.notes[3] = "Texture fixes.";
    });
    await button("Check for pack updates").click();
    await releases.getByText("Required since version 2", {exact: true}).waitFor();
    await releases.locator(".follow-release-summary").getByText("Server requires the new resource pack.").waitFor();
    await releases.getByText("Delight backs up your worlds before changing Minecraft versions.",{exact:true}).waitFor();
    const repair = releases.getByRole("button",{name:"Repair pack files",exact:true});
    await repair.waitFor();
    assert.ok(await repair.evaluate(element => element.classList.contains("ceramic-action")));
    const update = releases.getByRole("button",{name:"Update instance",exact:true});
    assert.ok(await update.isDisabled(), "A known repair must finish before an update");
    await repair.click();
    await releases.getByRole("status").filter({hasText:"Pack files repaired."}).waitFor();
    await releases.getByText("Replaced files saved to P:/preview/Pine Hollow/Repair backup",{exact:true}).waitFor();
    await page.waitForFunction(() => {
      const action = Array.from(document.querySelectorAll(".follow-release-actions button"))
        .find(button => button.textContent.trim() === "Update instance");
      return action && !action.disabled;
    });
    assert.deepEqual(await page.evaluate(() => ({
      repaired: window.revisionTest.repairs, installed: window.revisionTest.installed,
    })), {repaired:["followed-pine-hollow"], installed:1});
    await button("Back").click();
    await button("View update").click();
    await button("Update & play").waitFor();
    assert.equal(await button("Play current version").count(),0);
    await page.evaluate(() => {window.revisionTest.error = "A personal file uses Stonework.zip. Move or rename it before updating.";});
    await button("Update & play").click();
    await releases.getByRole("alert").filter({hasText:"personal file"}).waitFor();
    assert.deepEqual(await page.evaluate(() => [window.revisionTest.installed, window.revisionTest.launches.length]), [1,1]);
    await page.evaluate(() => {window.revisionTest.error = "";});
    await button("Update & play").click();
    await page.waitForFunction(() => window.revisionTest.launches.length === 2);
    assert.deepEqual(await page.evaluate(() => window.revisionTest.updates), ["followed-pine-hollow"]);
    await releases.getByText("Version 3 installed", {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.playerTest.installed), 0, "An update never calls the new-instance installer");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function checkOwnerRestore() {
  const page = await browser.newPage({viewport:{width:1000,height:700}, reducedMotion:"reduce"});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, {theme:"oled", revisions:true});
  const button = name => page.getByRole("button",{name,exact:true});
  const nav = page.getByRole("navigation",{name:"Pack Workspace pages"});
  const history = page.getByRole("region",{name:"Release history",exact:true});
  const review = page.getByRole("region",{name:"Restore release",exact:true});
  try {
    await page.goto(url, {waitUntil:"domcontentloaded"});
    await page.evaluate(() => {
      const revisions = window.revisionTest;
      revisions.head = 2;
      revisions.floor = 2;
      revisions.notes[2] = "Dropped the Stonework pack.";
      revisions.manifests[2] = {...revisions.manifests[1], files:revisions.manifests[1].files.filter(file => file.category !== "resourcepacks")};
      const saved = JSON.parse(localStorage.getItem("test-pack:1"));
      localStorage.setItem("test-pack:1",JSON.stringify({...saved, revision:2, releaseNote:revisions.notes[2]}));
      window.publicationTest.publisher.termsAccepted = true;
    });
    await page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Instances",exact:true}).click();
    await button("Actions for Pine Hollow").click();
    await button("Open Pack Workspace").click();
    await nav.getByRole("button",{name:"Releases",exact:true}).click();
    await history.getByRole("button",{name:"Restore version 1",exact:true}).click();
    assert.equal(await button("Restore version 2").count(), 0);
    await review.getByRole("heading",{name:"Restore release",exact:true}).waitFor();
    await review.getByText("Restore version 1 as version 3",{exact:true}).waitFor();
    await review.getByRole("list",{name:"Changes in the restore",exact:true}).getByText(/Stonework/).waitFor();
    assert.ok(await review.getByRole("radio",{name:"Optional",exact:true}).isChecked());
    const confirm = button("Restore as new release");
    assert.ok(await confirm.evaluate(element => element.matches(".ceramic-action") && element.closest(".instance-hero-actions")));
    await review.getByRole("radio",{name:"Required before play",exact:true}).check();
    assert.ok(await confirm.isDisabled(),"A required restore asks for a reason");
    const reason = review.getByRole("textbox",{name:"Reason for required update",exact:true});
    const releaseNote = "Bring Stonework back for the server.";
    await reason.fill(releaseNote);
    await page.evaluate(() => {
      const revisions = window.revisionTest;
      revisions.head = 3;
      revisions.manifests[3] = revisions.manifests[2];
      revisions.notes[3] = "A concurrent release.";
    });
    await confirm.click();
    await review.getByRole("alert").filter({hasText:"Review the latest release."}).waitFor();
    assert.ok(await confirm.isDisabled());
    await review.getByRole("button",{name:"Refresh review",exact:true}).click();
    await review.getByText("Restore version 1 as version 4",{exact:true}).waitFor();
    assert.equal(await reason.inputValue(),releaseNote);
    await confirm.click();
    await history.getByRole("status").filter({hasText:"Version 4 published."}).waitFor();
    const request = await page.evaluate(() => window.revisionTest.restores[0]);
    assert.deepEqual({...request, requestId:undefined}, {
      instanceId:"1", sourceRevision:1, baseRevision:3, releaseNote, required:true, acceptedTerms:true, requestId:undefined,
    });
    assert.match(request.requestId,/^[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(() => window.revisionTest.floor),4);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
}

async function checkPlayerLink(theme, viewport) {
  const animations = theme === "oled";
  const page = await browser.newPage({ viewport, reducedMotion: animations ? "no-preference" : "reduce" });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, {theme, animations});
  const snap = async name => { if (screenshots) await page.screenshot({path: join(screenshots, theme + "-player-" + name + ".png")}); };
  const canonical = "https://delightproductions.org/share/pack/PNHLW234";
  const panel = page.getByRole("region", {name:"Open player link", exact:true});
  const input = panel.getByRole("textbox", {name:"Player link"});
  const button = name => panel.getByRole("button",{name, exact:true});
  const heading = panel.getByRole("heading",{name:"Pine Hollow",exact:true});
  const tabs = panel.getByRole("tablist",{name:"Pack contents"});
  const tab = name => tabs.getByRole("tab",{name,exact:true});
  const files = name => panel.getByRole("tabpanel",{name,exact:true});
  const download = page.getByRole("region",{name:"Pack download",exact:true});
  const byMenu = async label => {
    await page.getByRole("menuitem",{name:"File", exact:true}).click();
    await page.getByRole("menuitem",{name:label,exact:true}).click();
  };
  try {
    await page.goto(url,{waitUntil:"domcontentloaded"});
    await byMenu("New instance");
    await page.getByRole("button",{name:"Open player link",exact:true}).click();
    await input.and(page.locator(":focus")).waitFor();
    await snap("paste");
    await input.fill("wrong"); await input.press("Enter");
    await panel.getByRole("alert").getByText(/valid Delight/).waitFor();
    await input.fill("  " + canonical + " "); await input.press("Enter");
    await heading.and(page.locator(":focus")).waitFor();
    assert.deepEqual(await tabs.getByRole("tab").allTextContents(), ["Mods","Resource packs","Shaders"]);
    assert.equal(await tab("Mods").getAttribute("aria-selected"), "true");
    assert.equal(await files("Mods").getByRole("img",{name:"Enabled",exact:true}).count(),1);
    assert.equal(await files("Resource packs").count(),0);
    assert.equal(await panel.getByText(/installs as a separate instance|Minecraft and Fabric may need additional downloads/i).count(),0);
    assert.ok(await panel.getByText("541.9 KB",{exact:true}).isVisible());
    await snap("preview");
    await tab("Resource packs").click();
    await files("Resource packs").getByRole("img",{name:"Disabled",exact:true}).waitFor();
    assert.equal(await files("Mods").count(),0);
    await tab("Resource packs").press("End");
    await files("Shaders").getByText("No shaders.",{exact:true}).waitFor();
    await tab("Shaders").press("Home");
    await files("Mods").waitFor();
    await page.evaluate(() => {window.playerTest.error="The release changed since your preview. Open the preview again before installing.";});
    await button("Install & follow").click(); await button("Refresh preview").waitFor();
    assert.ok(await button("Install & follow").isDisabled());
    await page.evaluate(()=>{window.playerTest.error="Couldn’t download a pack file. Try again.";});
    await button("Refresh preview").click();
    await button("Install & follow").click(); await panel.getByRole("alert").getByText(/download a pack file/).waitFor();
    await page.evaluate(() => {delete window.playerTest.error; window.playerTest.gate = new Promise(resolve => { window.playerTest.finish=resolve; });});
    await button("Install & follow").click(); await button("Installing…").waitFor(); assert.ok(await button("Installing…").isDisabled());
    await page.evaluate(link=>window.playerTest.send("workspace-install-progress",{link,message:"Preparing Minecraft and Fabric…",progress:55,
      downloadedBytes:0,totalBytes:0,bytesPerSecond:0}),canonical);
    await download.getByText("Preparing Minecraft and Fabric…",{exact:true}).waitFor();
    assert.doesNotMatch(await download.innerText(), /0\.0 KB downloaded/);
    await page.evaluate(link=>window.playerTest.send("workspace-install-progress",{link,message:"Downloading Minecraft libraries…",progress:64,
      downloadedBytes:2097152,totalBytes:4194304,bytesPerSecond:1048576}),canonical);
    await download.getByText("Downloading Minecraft libraries…",{exact:true}).waitFor();
    assert.equal(await download.getByRole("progressbar",{name:"Pack installation"}).getAttribute("value"),"64");
    await download.getByText("64%",{exact:true}).waitFor();
    await download.getByText("2.0 MB of 4.0 MB · 1.0 MB/s",{exact:true}).waitFor();
    const bar = await download.elementHandle();
    const display = await bar.evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished));
      const style = getComputedStyle(el);
      const bounds = el.getBoundingClientRect();
      const context = document.createElement("canvas").getContext("2d");
      context.fillStyle = style.backgroundColor;
      context.fillRect(0,0,1,1);
      return {
        right:innerWidth-bounds.right, bottom:innerHeight-bounds.bottom, width:bounds.width,
        alpha:context.getImageData(0,0,1,1).data[3], opacity:style.opacity,
        properties:style.transitionProperty.split(", "), duration:style.transitionDuration.split(", ").map(parseFloat),
      };
    });
    assert.ok(display.right >= 0 && display.right < 56 && display.bottom >= 0 && display.bottom < 56, "The progress bar sits inside the lower-right corner");
    assert.ok(display.width < viewport.width / 2, "The progress surface stays compact");
    assert.equal(display.alpha,255,"Progress details have a solid background in each theme");
    assert.equal(display.opacity,"1","Transfer details stay fully visible during the install");
    if (animations) {
      for (const property of ["opacity", "transform"]) {
        const index = display.properties.indexOf(property);
        assert.ok(index >= 0 && display.duration[index % display.duration.length] > 0, property + " transitions on the progress bar");
      }
    } else {
      assert.ok(display.duration.every(value => value === 0), "Reduced-motion mode skips progress transitions");
    }
    await snap("progress");
    await page.evaluate(()=>window.playerTest.finish());
    const target = page.getByRole("heading",{name:"Pine Hollow (2)",exact:true}); await target.waitFor();
    await download.waitFor({state:"hidden"});
    await page.waitForFunction(el => {
      const style = getComputedStyle(el);
      return el.isConnected && style.visibility === "hidden" && style.opacity === "0";
    }, bar);
    await bar.dispose();
    assert.equal(await page.evaluate(()=>window.playerTest.installed),1);
    await page.getByRole("button",{name:"Actions for Pine Hollow (2)",exact:true}).click();
    await page.getByRole("button",{name:"Open Pack Workspace",exact:true}).click();
    await page.getByRole("heading",{name:"Following shared pack"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Create shared pack"}).count(),0);
    await snap("following");
    await byMenu("Open player link"); await input.waitFor();
    await page.evaluate(()=>{window.playerTest.queue.push("delight://pack/PNHLW234");window.playerTest.send("workspace-player-link",null);});
    await button("Open instance").waitFor();
    await panel.getByText("Pine Hollow (2)",{exact:true}).waitFor();
    await snap("installed");
    const beforeRepeat = await page.evaluate(()=>window.playerTest.previews);
    await button("Back to player link").click(); await input.waitFor();
    await page.evaluate(()=>{window.playerTest.longList=true;window.playerTest.queue.push("delight://pack/PNHLW234");window.playerTest.send("workspace-player-link",null);});
    await button("Open instance").waitFor();
    assert.ok(await page.evaluate(()=>window.playerTest.previews)>beforeRepeat);
    assert.equal(await page.evaluate(()=>window.playerTest.installed),1);
    const modRows = files("Mods").getByRole("listitem");
    assert.equal(await modRows.count(),81);
    await modRows.nth(45).evaluate(el => el.scrollIntoView({block:"start",behavior:"instant"}));
    assert.ok((await modRows.first().boundingBox()).y < 0, "The test scrolled deep into the mod list");
    assert.ok(await tab("Resource packs").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2));
    }), "Resource packs is still reachable while browsing a long mod list");
    await tab("Mods").press("ArrowRight");
    await tab("Resource packs").and(page.locator(":focus")).waitFor();
    assert.equal(await panel.getByRole("tabpanel").count(),1);
    const resources = files("Resource packs").getByRole("listitem");
    assert.equal(await resources.count(),51);
    const resourceRow = resources.first();
    assert.ok(await resourceRow.getByRole("img",{name:"Disabled",exact:true}).isVisible());
    const rowBox = await resourceRow.boundingBox();
    assert.ok(rowBox && rowBox.y >= 0 && rowBox.y + rowBox.height <= viewport.height, "The first resource pack is reachable directly without scrolling through mods");
    const tabBox = await tabs.boundingBox();
    assert.ok(rowBox.y >= tabBox.y + tabBox.height && rowBox.y < tabBox.y + tabBox.height + 100, "The first row appears just below the selected category");
    await button("Open instance").click(); await target.waitFor();
    await page.evaluate(link=>sessionStorage.setItem("test-player-links",JSON.stringify([link,link])),canonical);
    await page.reload({waitUntil:"domcontentloaded"}); await button("Open instance").waitFor();
    assert.equal(await page.evaluate(()=>window.playerTest.installed),0);
    await page.evaluate(link=>{
      localStorage.removeItem("test-followed");
      sessionStorage.setItem("test-first-start","1"); sessionStorage.setItem("test-player-links",JSON.stringify([link]));
    },canonical);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:"Welcome to Delight"}).waitFor();
    assert.equal(await page.evaluate(()=>window.playerTest.previews),0);
    await page.getByRole("button",{name:"Connect Microsoft",exact:true}).click();
    await page.getByRole("button",{name:"Continue to launcher"}).click(); await button("Install & follow").waitFor();
    // Leaving during install must keep the native operation alive and preserve the next link until it finishes.
    await page.evaluate(()=>{window.playerTest.gate=new Promise(resolve=>{window.playerTest.finish=resolve;});});
    await button("Install & follow").click(); await button("Installing…").waitFor();
    const home = page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Home",exact:true});
    await home.click();
    await page.evaluate(link=>window.playerTest.send("workspace-install-progress",{link,progress:70,message:"Preparing Minecraft and Fabric…"}),canonical);
    await download.getByText("70%",{exact:true}).waitFor();
    await page.evaluate(link=>{window.playerTest.queue.push(link);window.playerTest.send("workspace-player-link",null);},canonical);
    assert.equal(await page.getByRole("region",{name:"Open player link",exact:true}).count(),0);
    await page.evaluate(()=>window.playerTest.finish());
    await button("Open instance").waitFor(); assert.equal(await page.evaluate(()=>window.playerTest.installed),1);
    assert.deepEqual(errors,[]);
  } catch(error) { await snap("failure"); console.error("Player link view:",await page.locator("main").innerText()); throw error; }
  finally { await page.close(); }
}

async function waitForInlinePackReview(page, review, heading) {
  await review.getByRole("heading", { name: heading, exact: true }).and(page.locator(":focus")).waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0, "Review should render inside the workspace");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await review.getByRole("button", { name: /^(Cancel|Close)/ }).count(), 0);
}

async function holdPackRepair(page) {
  await page.evaluate(() => {
    window.compatibility.mutationGate = new Promise(resolve => { window.compatibility.finishMutation = resolve; });
  });
}

async function checkContentResolution(theme, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, { theme });
  const button = (name, container = page) => container.getByRole("button", { name, exact: true });
  const row = (name, container = page) => container.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  const warning = container => container.getByRole("img", { name: "Needs attention", exact: true });
  const choose = button("Choose version · FerriteCore");
  const workspace = page.getByRole("region", { name: "Pack Workspace changes", exact: true });
  const review = workspace.getByRole("region", { name: "Choose version", exact: true });
  const back = button("Back to contents", workspace.locator(".instance-hero-actions"));
  const release = page.getByRole("region", { name: "First release", exact: true });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.compatibility.mode = "resolution";
      window.publicationTest.publisher.termsAccepted = true;
    });
    await button("Instances", page.getByRole("navigation", { name: "Main navigation" })).click();
    await button("Actions for Pine Hollow").click();
    await button("Open Pack Workspace").click();
    await button("Create shared pack").click();
    await choose.waitFor();
    const duplicateRows = row("FerriteCore");
    assert.equal(await duplicateRows.count(), 2);
    assert.equal(await warning(duplicateRows).count(), 2);
    assert.equal(await duplicateRows.getByRole("img", { name: "Enabled", exact: true }).count(), 0);
    assert.equal(await release.count(), 0, "A flagged duplicate must block the release");

    await choose.click();
    await waitForInlinePackReview(page, review, "Choose version");
    await review.getByText(/The other versions stay in this instance, disabled/).waitFor();
    await review.getByText("ferritecore.jar", { exact: true }).waitFor();
    await review.getByText("ferritecore-6.0.0.jar", { exact: true }).waitFor();
    const confirm = button("Disable other versions", review);
    assert.ok(await confirm.evaluate(node => node.classList.contains("ceramic-action")));
    assert.ok(await confirm.isDisabled(), "A version must be chosen explicitly");
    await back.press("Enter");
    await review.waitFor({ state: "hidden" });
    await choose.and(page.locator(":focus")).waitFor();
    assert.equal(await page.evaluate(() => window.compatibility.resolveRequests.length), 0);

    await choose.press("Enter");
    await review.getByRole("radio", { name: /7\.0\.2.*ferritecore\.jar/ }).press("Space");
    await review.getByText("Keep enabled", { exact: true }).waitFor();
    await review.getByText("Disable", { exact: true }).waitFor();
    await holdPackRepair(page);
    await confirm.click();
    await back.and(page.locator(":disabled")).waitFor();
    await page.evaluate(() => window.compatibility.finishMutation());
    await review.waitFor({ state: "hidden" });
    await release.waitFor();
    await release.getByText("Stays on this device", { exact: true }).waitFor();
    await release.getByText("local-hud.jar", { exact: true }).waitFor();
    await release.getByText("Files", { exact: true }).click();
    const delivered = release.getByRole("list", { name: "Mods", exact: true });
    assert.equal(await row("Local HUD", delivered).count(), 0);
    assert.equal(await row("FerriteCore", delivered).count(), 2);
    assert.equal(await page.evaluate(() => window.compatibility.resolveRequests.length), 1);

    await button("Publish version 1", release).click();
    await page.getByText("Version 1 published.", { exact: true }).waitFor();
    const result = await page.evaluate(() => ({
      request: window.publicationTest.requests.at(-1), review: window.compatibility.latest,
      manifest: window.revisionTest.manifests[1],
    }));
    assert.deepEqual(result.request.excludedLocalFiles, [{ fileName: "local-hud.jar", sha512: "c".repeat(128) }]);
    assert.equal(result.request.reviewToken, result.review.reviewToken);
    assert.equal(result.manifest.files.length, 4);
    assert.ok(result.manifest.files.some(file => file.fileName === "ferritecore-6.0.0.jar.disabled" && !file.enabled));
    assert.doesNotMatch(JSON.stringify(result.manifest), /local-hud\.jar/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function checkDependencyReview(theme, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.abort());
  await page.addInitScript(initializeLibrary, { theme });
  const button = (name, container = page) => container.getByRole("button", { name, exact: true });
  const review = button("Review dependencies");
  const workspace = page.getByRole("region", { name: "Pack Workspace changes", exact: true });
  const dependencies = workspace.getByRole("region", { name: "Install dependencies", exact: true });
  const back = button("Back to contents", workspace.locator(".instance-hero-actions"));
  const resourcePacks = workspace.getByRole("tab", { name: "Resource packs", exact: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.compatibility.mode = "dependencies";
      window.compatibility.dependenciesBlocked = true;
    });
    await button("Instances", page.getByRole("navigation", { name: "Main navigation" })).click();
    await button("Actions for Pine Hollow").click();
    await button("Open Pack Workspace").click();
    await button("Create shared pack").click();
    await resourcePacks.click();
    await review.click();
    await waitForInlinePackReview(page, dependencies, "Install dependencies");
    await dependencies.getByText("Two mods require different Fabric API versions.", { exact: true }).waitFor();
    const blocked = await dependencies.getByRole("button", { name: /^Install( available)? dependencies$/ }).all();
    for (const action of blocked) assert.ok(await action.isDisabled());
    await back.click();
    await dependencies.waitFor({ state: "hidden" });
    await review.and(page.locator(":focus")).waitFor();
    assert.equal(await resourcePacks.getAttribute("aria-selected"), "true");
    assert.equal(await page.evaluate(() => window.compatibility.dependencyApplies.length), 0);

    await page.evaluate(partial => {
      window.compatibility.dependenciesBlocked = false;
      window.compatibility.dependenciesPartial = partial;
    }, theme === "light");
    await review.press("Enter");
    await dependencies.getByText("Fabric API", { exact: true }).waitFor();
    await dependencies.getByText("Iris", { exact: true }).waitFor();
    assert.equal(await dependencies.getByText("Fabric API", { exact: true }).count(), 1);
    await dependencies.getByText("fabric-api.jar", { exact: true }).waitFor();
    await dependencies.getByText("iris.jar", { exact: true }).waitFor();
    if (theme === "light") await dependencies.getByText("One required mod has no compatible Fabric version.", { exact: true }).waitFor();
    const apply = dependencies.getByRole("button", { name: /^Install( available)? dependencies$/ });
    assert.ok(await apply.evaluate(node => node.classList.contains("ceramic-action")));
    assert.ok(await apply.isEnabled());
    await holdPackRepair(page);
    await apply.click();
    await back.and(page.locator(":disabled")).waitFor();
    await page.evaluate(() => window.compatibility.finishMutation());
    await dependencies.waitFor({ state: "hidden" });
    if (theme === "light") {
      await review.waitFor();
      assert.equal(await page.getByRole("region", { name: "First release", exact: true }).count(), 0);
    } else {
      await page.getByRole("region", { name: "First release", exact: true }).waitFor();
      assert.equal(await review.count(), 0);
    }
    const commands = await page.evaluate(() => ({
      reviewed: window.compatibility.dependencyReviews,
      applied: window.compatibility.dependencyApplies,
    }));
    const input = { instanceId: "1", excludedLocalFiles: [] };
    assert.ok(commands.reviewed.length >= 2);
    for (const reviewInput of commands.reviewed) assert.deepEqual(reviewInput, input);
    assert.deepEqual(commands.applied, [{ ...input, reviewToken: "dependency-review" }]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  await checkNavigation("oled", { width: 1440, height: 900 });
  await checkNavigation("light", { width: 900, height: 680 });
  await checkContentResolution("oled", { width: 1440, height: 900 });
  await checkContentResolution("light", { width: 900, height: 680 });
  await checkDependencyReview("oled", { width: 1440, height: 900 });
  await checkDependencyReview("light", { width: 900, height: 680 });
  await checkCreatorUpdates("oled", { width: 1440, height: 900 });
  await checkCreatorUpdates("light", { width: 900, height: 680 });
  await checkPlayerLink("oled", { width: 1440, height: 900 });
  await checkPlayerLink("light", { width: 900, height: 680 });
  await checkFollowerUpdates();
  await checkOwnerRestore();
  await checkAccess("oled", { width: 1440, height: 900 });
  await checkAccess("light", { width: 900, height: 680 });
  await checkDraftReview();
  console.log("Pack Workspace passed in OLED and minimum-size Light. Verified in-page reviews, duplicate resolution, full/partial/blocked dependency review, local-only mods, publishing, player links, follower updates and repair, release restore, Access, and draft review.");
} finally {
  await browser.close();
}
