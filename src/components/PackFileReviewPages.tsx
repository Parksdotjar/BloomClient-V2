import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Download, RefreshCw } from "lucide-react";
import { invoke } from "../services/invoke";
import type { ExcludedLocalPackFile, PackDependencyReview } from "../services/pack-compatibility";
import { userError } from "../services/user-error";
import { InstalledContentRow, type InstanceContentItem } from "./InstalledContentRow";

export type DuplicateCandidate = ExcludedLocalPackFile & Pick<InstanceContentItem, "name" | "version" | "icon" | "size">;
export type DuplicateChoice = { modId: string; candidates: DuplicateCandidate[] };

function PackFileReviewPage({ title, action, children }: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);

  return <section className="pack-contents-review pack-file-review" aria-labelledby={id}>
    <header className="pack-file-review-heading">
      <h2 ref={heading} id={id} tabIndex={-1}>{title}</h2>
      {action}
    </header>
    {children}
  </section>;
}

function useReviewWrite(onBusy: (busy: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const writing = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const write = async (operation: () => Promise<unknown>, onSuccess: () => void, onFailure: (reason: unknown) => void) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    onBusy(true);
    try {
      await operation();
    } catch (reason) {
      if (active.current) {
        writing.current = false;
        setBusy(false);
        onBusy(false);
        onFailure(reason);
      }
      return;
    }
    if (active.current) {
      onBusy(false);
      onSuccess();
    }
  };
  return { busy, write };
}

export function DuplicateResolutionPage({ choice, instanceId, loader, onBusy, onResolved, instanceMods = false }: {
  choice: DuplicateChoice;
  instanceId: string;
  loader: string;
  onBusy: (busy: boolean) => void;
  onResolved: () => void;
  instanceMods?: boolean;
}) {
  const id = useId();
  const [keepFileName, setKeepFileName] = useState("");
  const [error, setError] = useState("");
  const { busy, write } = useReviewWrite(onBusy);
  const resolve = () => {
    if (!keepFileName || busy) return;
    setError("");
    void write(() => invoke(instanceMods ? "choose_mod_version" : "resolve_pack_mod_conflict", {
      instanceId, modId: choice.modId, keepFileName,
      candidates: choice.candidates.map(({ fileName, sha512 }) => ({ fileName, sha512 })),
    }), onResolved, reason => setError(userError(reason)));
  };

  return <PackFileReviewPage title="Choose version" action={
    <button type="button" className="instance-play ceramic-action pack-workspace-action" disabled={busy || !keepFileName} onClick={resolve}>
      {instanceMods ? busy ? "Archiving…" : "Keep this version" : busy ? "Disabling…" : "Disable other versions"}
    </button>
  }>
    <p>{instanceMods ? "The other versions are moved to a local backup." : "The other versions stay in this instance, disabled."}</p>
    {error && <p className="pack-publication-error" role="alert">{error}</p>}
    <div className="pack-contents-panel instance-content-list-shell">
      <fieldset className="pack-file-review-versions" disabled={busy}>
        <legend className="sr-only">{choice.candidates[0].name || choice.modId}</legend>
        <div className="desktop-content-columns pack-contents-columns" aria-hidden="true"><span>Version</span><span>Change</span></div>
        <ul className="pack-contents-list">
          {choice.candidates.map(candidate => <InstalledContentRow key={candidate.fileName} category="mods" loader={loader}
            item={{ ...candidate, id: candidate.fileName, enabled: true }} note={candidate.version
              ? <span className="pack-file-source">{candidate.fileName}</span>
              : undefined}>
            <input className="pack-file-review-choice" type="radio" name={id} value={candidate.fileName}
              aria-label={[candidate.version, candidate.fileName].filter(Boolean).join(" · ")}
              checked={keepFileName === candidate.fileName} onChange={() => setKeepFileName(candidate.fileName)} />
            {keepFileName && <span>{keepFileName === candidate.fileName ? "Keep enabled" : instanceMods ? "Back up" : "Disable"}</span>}
          </InstalledContentRow>)}
        </ul>
      </fieldset>
    </div>
  </PackFileReviewPage>;
}

export function DependencyReviewPage({ excludedLocalFiles, instanceId, loader, onBusy, onResolved }: {
  excludedLocalFiles: ExcludedLocalPackFile[];
  instanceId: string;
  loader: string;
  onBusy: (busy: boolean) => void;
  onResolved: () => void;
}) {
  const [plan, setPlan] = useState<PackDependencyReview | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const { busy, write } = useReviewWrite(onBusy);
  const pending = useRef<{ instanceId: string; excludedLocalFiles: ExcludedLocalPackFile[]; attempt: number; review: Promise<PackDependencyReview> } | null>(null);
  useEffect(() => {
    let current = true;
    const request = pending.current;
    // A replayed effect observes the same plan instead of starting another scan.
    if (!request || request.instanceId !== instanceId || request.excludedLocalFiles !== excludedLocalFiles || request.attempt !== attempt) {
      pending.current = { instanceId, excludedLocalFiles, attempt, review: invoke<PackDependencyReview>("review_pack_dependencies", {
        instanceId, excludedLocalFiles,
      }) };
    }
    void pending.current?.review.then(next => { if (current) setPlan(next); }, reason => { if (current) setError(userError(reason)); });
    return () => { current = false; };
  }, [instanceId, excludedLocalFiles, attempt]);

  const install = () => {
    if (busy || !plan?.reviewToken || !plan.actions.length) return;
    void write(() => invoke("apply_pack_dependencies", {
      instanceId, reviewToken: plan.reviewToken, excludedLocalFiles,
    }), onResolved, reason => {
      setPlan(null);
      setError(userError(reason));
    });
  };

  return <PackFileReviewPage title="Install dependencies" action={
    <button type="button" className="instance-play ceramic-action pack-workspace-action"
      disabled={busy || !plan?.reviewToken || !plan.actions.length} onClick={install}>
      <Download size={16} aria-hidden="true" />
      {busy ? "Installing…" : plan?.reviewToken && plan.issues.length ? "Install available dependencies" : "Install dependencies"}
    </button>
  }>
    {error ? <div className="pack-check-line">
      <p className="pack-publication-error" role="alert">{error}</p>
      <button type="button" className="settings-action" onClick={() => { setError(""); setAttempt(value => value + 1); }}>
        <RefreshCw size={15} aria-hidden="true" />Retry
      </button>
    </div> : !plan ? <p role="status">Checking dependencies…</p> : <>
      <DependencyPlanContents plan={plan} loader={loader} />
    </>}
  </PackFileReviewPage>;
}

export function DependencyPlanContents({ plan, loader }: { plan: PackDependencyReview; loader: string }) {
  return <>
      {!!plan.actions.length && <div className="pack-contents-panel instance-content-list-shell">
        <div className="desktop-content-columns pack-contents-columns" aria-hidden="true"><span>Name</span><span>Change</span></div>
        <ul className="pack-contents-list" aria-label="Dependency changes">
          {plan.actions.map(item => <InstalledContentRow key={item.fileName} category="mods" loader={loader}
            item={{ ...item, id: item.fileName, enabled: item.kind === "enable" }}
            note={<>
              {item.version && <span className="pack-file-source">{item.fileName}</span>}
              {!!item.requiredBy.length && <span className="pack-file-source">Required by {item.requiredBy.join(", ")}</span>}
            </>}>
            <span>{item.kind === "enable" ? "Enable" : "Download"}</span>
          </InstalledContentRow>)}
        </ul>
      </div>}
      {!!plan.issues.length && <ul className="pack-instance-issues" aria-label="Dependency issues">
        {plan.issues.map(issue => <li key={issue}><CircleAlert size={15} aria-hidden="true" />{issue}</li>)}
      </ul>}
      {!plan.actions.length && !plan.issues.length && <p role="status">No missing dependencies found.</p>}
  </>;
}
