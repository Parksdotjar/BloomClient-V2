import { useEffect, useRef, useState, type ComponentType } from "react";
import { invoke } from "../services/invoke";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronDown, Clipboard, Cuboid, Download, ExternalLink, Play, RotateCw, TriangleAlert, WandSparkles } from "lucide-react";
import { BENCHMARK_INSTANCE, BENCHMARK_LAUNCH, BENCHMARK_VERSION, buildAutoTuneProfile, readAutoTuneProfile, validateBenchmark, type AutoTuneProfile, type MinecraftBenchmarkResult, type TuningHardware } from "../services/autotune";
import "./autotune.css";

type Stage = "checking" | "install" | "installing" | "ready" | "starting" | "running" | "result" | "profile" | "apply" | "done" | "error";
type Status = { state: string; progress: number; message: string; runId?: string; instanceId?: string };
type JournalEntry = { time: number; message: string };
const journalKey = "bloom-autotune-journal-v2";
const readJournal = (): JournalEntry[] => {
  try {
    const entries = JSON.parse(sessionStorage.getItem(journalKey) || "[]");
    return Array.isArray(entries) ? entries.filter(entry => entry && Number.isFinite(entry.time) && typeof entry.message === "string").slice(-120) : [];
  } catch { return []; }
};

export function AutoTuneWorkflow({ hardwareScan: HardwareScan }: { hardwareScan: ComponentType<{ onComplete: () => void }> }) {
  const [hardwareReady, setHardwareReady] = useState(() => Boolean(localStorage.getItem("bloom-autotune-hardware")));
  const [stage, setStage] = useState<Stage>("checking");
  const [step, setStep] = useState(2);
  const [message, setMessage] = useState("Checking saved progress");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MinecraftBenchmarkResult | null>(null);
  const [profile, setProfile] = useState<AutoTuneProfile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [instanceCount, setInstanceCount] = useState(0);
  const [journal, setJournal] = useState(readJournal);
  const [copied, setCopied] = useState(false);
  const operation = useRef(false);
  const runId = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const log = (text: string) => setJournal(previous => {
    if (previous.at(-1)?.message === text) return previous;
    const next = [...previous, { time: Date.now(), message: text.slice(0, 2000) }].slice(-120);
    try { sessionStorage.setItem(journalKey, JSON.stringify(next)); } catch { /* Logging must not stop a run. */ }
    return next;
  });
  const fail = (reason: unknown) => { const text = String(reason); setMessage(text); log(text); setStage("error"); };
  const acceptResult = (value: unknown) => {
    validateBenchmark(value);
    if (runId.current && value.runId !== runId.current) throw new Error("The saved result belongs to an earlier test. Run the benchmark again.");
    setResult(value); setProgress(100); setStep(3); setStage("result");
    localStorage.setItem("bloom-autotune-minecraft-complete", String(value.completedAt));
    log(`Measured ${value.averageFps.toFixed(1)} FPS, ${value.onePercentLow.toFixed(1)} FPS 1% low in Minecraft ${value.minecraftVersion}.`);
  };
  useEffect(() => {
    if (!hardwareReady) return;
    let disposed = false;
    void (async () => {
      try {
        const launch = await invoke<Status>("get_minecraft_launch_status");
        if (disposed) return;
        if (launch?.instanceId === BENCHMARK_INSTANCE && ["installing", "launching", "running"].includes(launch.state)) {
          const status = await invoke<Status | null>("get_autotune_benchmark_status").catch(() => null);
          if (disposed) return;
          if (status?.state !== "complete") {
            runId.current = status?.runId || null;
            setStep(status?.runId ? 3 : 2); setStage(status?.runId ? "running" : "installing"); return;
          }
        }
        const value = await invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result");
        if (disposed) return;
        if (value) {
          validateBenchmark(value); setResult(value);
          const saved = readAutoTuneProfile();
          if (saved?.benchmark.runId === value.runId) {
            setProfile(saved); setStep(5); setStage("apply");
            const applied = await invoke<AutoTuneProfile | null>("get_applied_autotune_profile");
            if (!disposed && applied?.benchmarkCompletedAt === saved.benchmarkCompletedAt) setStage("done");
          } else { setStep(3); setStage("result"); }
        } else setStage("install");
      } catch (reason) { if (!disposed) { setStage("install"); setMessage(String(reason)); } }
    })();
    return () => { disposed = true; };
  }, [hardwareReady]);

  useEffect(() => {
    if (stage !== "installing" && stage !== "running") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    let failures = 0;
    const poll = async () => {
      try {
        const launch = await invoke<Status>("get_minecraft_launch_status");
        if (disposed) return;
        if (stage === "running") {
          const status = await invoke<Status | null>("get_autotune_benchmark_status");
          if (disposed) return;
          if (status?.runId && (!runId.current || status.runId === runId.current)) {
            runId.current = status.runId;
            setMessage(status.message); log(status.message); setProgress(Math.min(100, Math.max(0, status.progress)));
            if (status.state === "error") { fail(status.message); return; }
            if (status.state === "complete") {
              const value = await invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result");
              if (!disposed) acceptResult(value);
              return;
            }
          }
          if (launch?.instanceId === BENCHMARK_INSTANCE && ["idle", "error", "cancelled"].includes(launch.state)) {
            fail(launch.state === "idle" ? "Minecraft closed before completing the test. Run it again and keep its window focused." : launch.message); return;
          }
          if (!status && launch?.instanceId === BENCHMARK_INSTANCE) { setMessage(launch.message); log(launch.message); }
        } else if (launch?.instanceId === BENCHMARK_INSTANCE) {
          setMessage(launch.message); log(launch.message); setProgress(launch.progress);
          if (launch.state === "complete") { setStage("ready"); setStep(3); return; }
          if (["error", "cancelled"].includes(launch.state)) { fail(launch.message); return; }
        }
        failures = 0;
        if (Date.now() - started > (stage === "running" ? 15 : 45) * 60_000) { fail("The benchmark is taking longer than expected. Check Minecraft and the launch logs, then retry once it has closed."); return; }
      } catch (reason) {
        if (!disposed && ++failures >= 5) { fail(reason); return; }
      }
      if (!disposed) timer = setTimeout(() => void poll(), 750);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [stage]);

  useEffect(() => {
    if (stage !== "apply") return;
    let disposed = false;
    void invoke<Array<{ engine?: string }>>("list_instances").then(items => { if (!disposed) setInstanceCount(items.filter(i => i.engine !== "sakura").length); }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [stage]);

  const act = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try { await action(); } catch (reason) { if (alive.current) { setError(String(reason)); log(String(reason)); } }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const install = () => act(async () => {
    setStep(2); setMessage("Preparing the private benchmark instance"); setProgress(0);
    try {
      await invoke("install_autotune_benchmark");
      localStorage.removeItem("bloom-autotune-profile"); localStorage.removeItem("bloom-autotune-minecraft-complete");
      runId.current = null; setProfile(null); setResult(null); setAppliedCount(null); setConfirming(false);
      log(`Installing Minecraft ${BENCHMARK_VERSION} and the controlled benchmark.`); setStage("installing");
    } catch (reason) { fail(reason); }
  });
  const launch = () => act(async () => {
    setStep(3); setStage("starting"); setProgress(0); setMessage(`Starting Minecraft ${BENCHMARK_VERSION}`);
    try { await invoke("launch_minecraft", BENCHMARK_LAUNCH); runId.current = null; log(`Starting Minecraft ${BENCHMARK_VERSION}.`); setStage("running"); }
    catch (reason) { fail(reason); }
  });
  const tune = () => act(async () => {
    const [hardware, measured] = await Promise.all([invoke<TuningHardware>("detect_hardware_report"), invoke<MinecraftBenchmarkResult>("get_autotune_benchmark_result")]);
    const next = buildAutoTuneProfile(hardware, measured);
    localStorage.setItem("bloom-autotune-profile", JSON.stringify(next));
    setProfile(next); setStage("apply"); setStep(5); log(`Profile ready: ${next.memoryMb} MB, ${next.graphics}, render ${next.renderDistance}, simulation ${next.simulationDistance}.`);
  });
  const apply = () => act(async () => {
    if (!profile) return;
    const count = await invoke<number>("apply_autotune_profile", { profile });
    setAppliedCount(count); setConfirming(false); setStage("done"); log(`Applied settings to ${count} Java instances and saved defaults for future Java instances.`);
  });
  const copyReport = () => act(async () => {
    await navigator.clipboard.writeText(JSON.stringify({ benchmark: result, profile, log: journal }, null, 2));
    setCopied(true);
  });
  if (!hardwareReady) return <HardwareScan onComplete={() => setHardwareReady(true)} />;
  const working = ["checking", "installing", "starting", "running"].includes(stage);
  const title = step === 2 ? "Install benchmark" : step === 3 ? "Test Minecraft" : step === 4 ? "Build profile" : stage === "done" ? "AutoTune complete" : "Apply AutoTune";
  return <div className="autotune-flow-shell"><section className="autotune-step-screen">
    <header className="autotune-step-header"><h1>{title}</h1></header>
    {stage === "install" && <div className="autotune-action-card autotune-benchmark-permission-card"><span className="autotune-step-mark"><Cuboid size={25} /></span><div className="autotune-permission-copy"><b>Benchmark Minecraft {BENCHMARK_VERSION}</b><p>A private test world measures your PC. Personal worlds and instances stay untouched.</p><details className="autotune-disclosure"><summary>Show details</summary><p>Downloads Minecraft {BENCHMARK_VERSION}, Fabric and Bloom’s benchmark mod. A 15-second warm-up precedes 60 seconds of measurement at a fixed 1280 × 720 window size. Keep Minecraft focused and close heavy apps. Reinstalling replaces only Bloom’s managed test world. Results stay on this PC.</p></details></div><button disabled={busy} onClick={() => void install()}>Install</button></div>}
    {working && <div className="autotune-action-card centered" role="status"><span className="autotune-step-mark">{step === 2 ? <Download size={23} /> : <Play size={23} />}</span><b>{stage === "checking" ? "Checking progress" : stage === "installing" ? "Installing benchmark" : "Testing Minecraft"}</b><p>{message}</p><div className="autotune-simple-progress"><i style={{ width: `${progress}%` }} /></div>{stage !== "checking" && <small>{Math.round(progress)}%</small>}</div>}
    {(stage === "running" || stage === "installing") && <button className="autotune-secondary-action" disabled={busy} onClick={() => void act(async () => { await invoke("cancel_autotune_benchmark"); log("Stop requested. Waiting for Minecraft or installation to finish closing."); })}>Stop test</button>}
    {stage === "ready" && <div className="autotune-action-card"><span className="autotune-step-mark complete"><Check size={23} /></span><div><b>Ready to test</b><p>Keep Minecraft focused. It measures and closes automatically.</p></div><button disabled={busy} onClick={() => void launch()}><Play size={15} />Run test</button></div>}
    {stage === "error" && <div className="autotune-action-card"><span className="autotune-step-mark error"><TriangleAlert size={22} /></span><div><b>Benchmark stopped</b><p role="alert">{message}</p></div><button disabled={busy} onClick={() => { setError(""); setStage(step === 3 ? "ready" : "install"); }}>Try again</button></div>}
    {stage === "result" && result && <div className="autotune-result-card"><div className="autotune-result-lead"><span className="autotune-step-mark complete"><Check size={22} /></span><div><b>{result.averageFps.toFixed(1)} FPS</b><p>Minecraft {result.minecraftVersion} baseline · {result.width} × {result.height}</p></div></div><div className="autotune-stat-grid"><div><small>1% low</small><b>{result.onePercentLow.toFixed(1)} FPS</b></div><div><small>95th percentile</small><b>{result.p95FrameTimeMs.toFixed(2)} ms</b></div><div><small>Peak Java heap</small><b>{(result.peakMemoryBytes / 1073741824).toFixed(2)} GB</b></div></div><button className="autotune-primary-action" onClick={() => { setStep(4); setStage("profile"); }}>Continue</button></div>}
    {stage === "profile" && <div className="autotune-action-card centered"><span className="autotune-step-mark"><WandSparkles size={24} /></span><b>{busy ? "Building your profile" : "Ready to tune"}</b><p>Compare measured performance, display target and available memory.</p><button disabled={busy} onClick={() => void tune()}>{busy ? "Tuning…" : "Build profile"}</button></div>}
    {(stage === "apply" || stage === "done") && profile && <div className="autotune-result-card">
      <div className="autotune-result-lead"><span className="autotune-step-mark complete"><Check size={22} /></span><div><b>{stage === "done" ? "Your optimized settings are ready" : "Your profile is ready"}</b><p>{stage === "done" ? `${appliedCount === null ? "Saved settings are active" : `Updated ${appliedCount} Java instance${appliedCount === 1 ? "" : "s"}`}. Future Java instances inherit this profile.` : profile.confidence}</p></div></div>
      <div className="autotune-stat-grid"><div><small>Memory</small><b>{(profile.memoryMb / 1024).toFixed(1)} GB</b></div><div><small>Graphics</small><b>{profile.graphics}</b></div><div><small>Render / simulation</small><b>{profile.renderDistance} / {profile.simulationDistance}</b></div></div>
      <details className="autotune-disclosure"><summary>Measurements & tuning reasons<ChevronDown size={14} /></summary><div className="autotune-reasons">{profile.reasons.map(reason => <div key={reason.title}><b>{reason.title}</b><p>{reason.detail}</p></div>)}</div></details>
      <p className="autotune-report-note">Based on the controlled Minecraft {BENCHMARK_VERSION} test. Performance in your own worlds has not been retested.</p>
      {stage === "apply" && (confirming ? <div className="autotune-confirm-row"><div><b>Apply to {instanceCount} Java instance{instanceCount === 1 ? "" : "s"}?</b><p>Replaces memory, Java flags and managed graphics settings. Close Minecraft first. Also sets defaults for future Java instances.</p></div><button disabled={busy} className="autotune-secondary-action" onClick={() => setConfirming(false)}>Cancel</button><button disabled={busy} onClick={() => void apply()}>{busy ? "Applying…" : "Apply"}</button></div> : <button className="autotune-primary-action" disabled={busy} onClick={() => setConfirming(true)}>Apply profile</button>)}
      {stage === "done" && <details className="autotune-disclosure" open><summary>Optional performance mods<ChevronDown size={14} /></summary><p>Review a release matching your instance’s Minecraft version and loader. These suggestions were not part of the benchmark.</p><div className="autotune-mods">{[
        ["Sodium", "sodium", "Rendering and frame-rate improvements."],
        ["Lithium", "lithium", "Game logic and simulation optimizations."],
        ["FerriteCore", "ferrite-core", "Lower memory use, especially useful for larger modpacks."],
      ].map(([name, slug, description]) => <button key={slug} disabled={busy} onClick={() => void act(() => openUrl(`https://modrinth.com/mod/${slug}`))}><span><b>{name}</b><small>{description}</small></span><ExternalLink size={15} /></button>)}</div></details>}
    </div>}
    {error && <div className="autotune-inline-error" role="alert"><TriangleAlert size={15} /><span>{error}</span></div>}
    <details className="autotune-disclosure autotune-log"><summary>Run log<ChevronDown size={14} /></summary><div className="autotune-log-lines" role="log" aria-label="AutoTune run log">{journal.length ? journal.map((entry, index) => <p key={`${entry.time}:${index}`}><time>{new Date(entry.time).toLocaleTimeString()}</time><span>{entry.message}</span></p>) : <p>Waiting to begin the benchmark.</p>}</div><button className="autotune-secondary-action" disabled={busy} onClick={() => void copyReport()}><Clipboard size={14} />{copied ? "Report copied" : "Copy report"}</button></details>
    {["result", "apply", "done", "error"].includes(stage) && <button className="autotune-secondary-action" disabled={busy} onClick={() => { setStage("install"); setStep(2); setError(""); }}><RotateCw size={14} />Set up a new test</button>}
  </section><div className="autotune-flow-progress" aria-label={`AutoTune step ${step} of 5`}>{[1, 2, 3, 4, 5].map(item => <span key={item} aria-current={item === step ? "step" : undefined} className={item < step ? "complete" : item === step ? "active" : ""} />)}</div></div>;
}
