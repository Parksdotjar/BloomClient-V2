import { useContext, useEffect, useRef, useState } from "react";
import { ArrowRight, Download, Play, RefreshCw, Wrench } from "lucide-react";
import { FollowUpdateContext, hasUpdate, type FollowRepair } from "../services/follow-updates";
import { userError } from "../services/user-error";
import { invoke } from "../services/invoke";
import type { WorkspaceInstance } from "./PackWorkspace";
import { WorkspaceReleaseHistory } from "./WorkspaceReleaseHistory";
import { PackChangeList } from "./PackChangeList";
import "./follow-updates.css";

export function FollowedPackReleases({instance}: {instance: WorkspaceInstance}) {
  const actions = useContext(FollowUpdateContext)!;
  const {check} = actions;
  const review = actions.reviews[instance.id];
  const pending = !!review && hasUpdate(review);
  const [checking, setChecking] = useState(true);
  const [applying, setApplying] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<FollowRepair>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [policyNote, setPolicyNote] = useState("");
  const floor = pending && review.required && review.minimumPlayableRevision < review.latestRevision ? review.minimumPlayableRevision : null;
  const playerUrl = review?.playerUrl;
  useEffect(() => {
    let current = true;
    setPolicyNote("");
    if (floor && playerUrl) void invoke<{releaseNote: string}>("get_workspace_release", {playerUrl, revision: floor})
      .then(release => { if (current) setPolicyNote(release.releaseNote); }).catch(() => {});
    return () => { current = false; };
  }, [floor, playerUrl, attempt]);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setChecking(true);
    setError("");
    check(instance.id).catch(reason => { if (current) setError(userError(reason)); })
      .finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [check, instance.id, attempt]);
  const apply = async () => {
    if (!pending || applying || review.repairNeeded) return;
    setApplying(true);
    setError("");
    try { await actions.apply(instance.id, review, () => active.current); }
    catch (reason) { if (active.current) setError(userError(reason)); }
    finally { if (active.current) setApplying(false); }
  };
  const repair = async () => {
    if (!review || repairing) return;
    setRepairing(true);
    setError("");
    setRepairResult(undefined);
    try {
      const result = await actions.repair(instance.id, review);
      if (active.current) setRepairResult(result);
    } catch (reason) {
      if (active.current) setError(userError(reason));
    } finally {
      if (active.current) setRepairing(false);
    }
  };
  const busy = actions.busy || applying || repairing;
  const play = actions.playRequested(instance.id);
  return <section className="followed-releases" aria-label="Followed pack releases">
    <div className="follow-release-summary">
      <div>
        {review && <p className="follow-release-version">{pending
          ? <>Version {review.installedRevision} <ArrowRight aria-label="to" size={14}/> {review.latestRevision}</>
          : <>Version {review.installedRevision} installed</>}</p>}
        {pending && <p className="follow-release-policy">{floor ? "Required since version " + floor : review.required ? "Required update" : "Optional update"}</p>}
        {floor && policyNote && <p className="follow-release-note">{policyNote}</p>}
      </div>
      <div className="follow-release-actions">
        <button type="button" className="settings-action" title="Check for updates" aria-label="Check for pack updates"
          disabled={checking || applying || repairing} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true"/></button>
        {play && review && !review.required && <button type="button" className="settings-action" disabled={busy}
          onClick={() => actions.playInstalled(instance.id)}><Play size={14}/>{pending ? "Play current version" : "Play"}</button>}
        {review && !review.offline && <button type="button"
          className={review.repairNeeded ? "instance-play ceramic-action pack-workspace-action" : "settings-action"}
          disabled={busy || checking} onClick={() => void repair()}>
          <Wrench size={15} aria-hidden="true" />{repairing ? "Repairing…" : "Repair pack files"}
        </button>}
        {pending && <button type="button" className="instance-play ceramic-action pack-workspace-action"
          disabled={busy || checking || !!review.offline || !!review.repairNeeded}
          onClick={() => void apply()}><Download size={16}/>{applying ? "Updating…" : play ? "Update & play" : "Update instance"}</button>}
      </div>
    </div>
    {error && <p role="alert" className="player-link-error">{error}</p>}
    {review?.repairNeeded && <p className="follow-release-policy">{review.repairReason || "Repair the managed pack files to continue."}</p>}
    {repairResult && <div role="status" className="follow-release-policy">
      {repairResult.repairedFiles ? "Pack files repaired." : "Pack files are up to date."}
      {repairResult.backupDirectory && <small className="follow-backup-path">Replaced files saved to {repairResult.backupDirectory}</small>}
    </div>}
    {review?.worldBackupDirectory && <p className="follow-release-policy follow-backup-path">World backup saved to {review.worldBackupDirectory}</p>}
    {checking && !review && <p role="status">Checking for updates…</p>}
    {review?.offline && <p role="status">Offline · Last checked release</p>}
    {pending && <>
      {review.releaseNote && <p className="follow-release-note">{review.releaseNote}</p>}
      {review.minecraftVersionChanged && <p className="follow-release-policy">Delight backs up your worlds before changing Minecraft versions.</p>}
      <PackChangeList changes={review.changes} label="Changes since installed version" />
    </>}
    {pending ? <details className="follow-history-disclosure" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>Release history</summary>
      {historyOpen && <WorkspaceReleaseHistory instanceId={instance.id} />}
    </details> : review && <WorkspaceReleaseHistory instanceId={instance.id} />}
  </section>;
}
