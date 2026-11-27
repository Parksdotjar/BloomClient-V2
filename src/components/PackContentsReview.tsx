import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRightIcon as ArrowRight, WarningCircleIcon as CircleAlert, PackageIcon as PackagePlus, ArrowsClockwiseIcon as RefreshCw } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { matchCheckedFiles, packFileKey, type CheckedPackFile, type ExcludedLocalPackFile, type PackCompatibility } from "../services/pack-compatibility";
import { InstalledContentRow, usePackArtwork, type ContentCategory, type InstanceContentItem } from "./InstalledContentRow";
import { PackLocalExclusions, PackPublicationForm, type PackPublication } from "./PackPublication";
import { packContentCategories as categories, PackContentTabs } from "./PackContentTabs";
import { PackRevisionReview } from "./PackRevisionReview";
import { DependencyReviewPage, DuplicateResolutionPage, type DuplicateCandidate, type DuplicateChoice } from "./PackFileReviewPages";
import type { DraftEditing } from "../services/workspace-drafts";
import "./pack-contents-review.css";

type Inventory = Record<ContentCategory, InstanceContentItem[]>;
type Result<T> = { value: T } | { error: string } | null;
type FileReview = { kind: "duplicate"; choice: DuplicateChoice }
  | { kind: "dependencies"; excludedLocalFiles: ExcludedLocalPackFile[] };
export type ReleaseDraft = { note: string; required: boolean };

async function readInventory(instanceId: string): Promise<Inventory> {
  const groups = await Promise.all(categories.map(async ({ category, label }) => {
    try {
      return await invoke<InstanceContentItem[]>("list_instance_content", { instanceId, category, forSharing: true });
    } catch (error) {
      throw new Error(`Couldn’t read ${label.toLowerCase()}. ${String(error)}`);
    }
  }));
  return { mods: groups[0], resourcepacks: groups[1], shaderpacks: groups[2] };
}

function PackFileList({ instanceId, category, label, loader, files, checked, showSources = false, localChoices = [], onKeepLocal, onChooseVersion }: {
  instanceId: string; category: ContentCategory; label: string; loader: string;
  files: InstanceContentItem[]; checked?: Map<string, CheckedPackFile> | null; showSources?: boolean;
  localChoices?: ExcludedLocalPackFile[];
  onKeepLocal?: (file: ExcludedLocalPackFile, keep: boolean) => void;
  onChooseVersion?: (choice: DuplicateChoice) => void;
}) {
  const artwork = usePackArtwork(instanceId, category, files, true);
  if (!files.length) return <p>No {label.toLowerCase()} installed.</p>;
  const duplicates = new Map<string, DuplicateCandidate[] | null>();
  if (onChooseVersion) for (const item of files) {
    const file = checked?.get(packFileKey(category, item.fileName));
    if (!file?.duplicateGroup || !file.enabled) continue;
    const candidates = duplicates.get(file.duplicateGroup);
    if (!file.sha512) {
      duplicates.set(file.duplicateGroup, null);
      continue;
    }
    if (candidates === null) continue;
    const group = candidates ?? [];
    group.push({ fileName: item.fileName, sha512: file.sha512, name: item.name, version: item.version, icon: item.icon, size: item.size });
    duplicates.set(file.duplicateGroup, group);
  }
  return <>
    <div className="desktop-content-columns pack-contents-columns" aria-hidden="true"><span>Name</span><span>Status</span></div>
    <ul className="pack-contents-list" aria-label={label}>
      {files.map(item => {
        const file = checked?.get(packFileKey(category, item.fileName));
        const modId = file?.duplicateGroup;
        const group = modId ? duplicates.get(modId) : undefined;
        const localFile = file?.sha512 && (file.canKeepLocal || file.state === "localOnly")
          ? { fileName: file.fileName, sha512: file.sha512 } : undefined;
        const localChoice = localFile && localChoices.some(choice => choice.fileName === localFile.fileName && choice.sha512 === localFile.sha512);
        let detail;
        if (file?.state === "issue") {
          detail = <span className="pack-file-issue" tabIndex={-1}>
            <CircleAlert size={15} aria-hidden="true" /><span>{file.message}</span>
          </span>;
        } else if (file?.state === "localOnly") {
          detail = <span className="pack-file-source">Kept in this instance only.</span>;
        } else if (showSources && file) {
          const source = file.state === "managed" ? "Provided separately by Delight" : file.message || "Verified on Modrinth";
          const sourcePin = file.state === "verified" ? `Modrinth project ${file.projectId} · Version ${file.versionId}` : undefined;
          detail = <span className="pack-file-source" title={sourcePin}>{item.version && file.fileName + " · "}{source}</span>;
        }
        return <InstalledContentRow key={item.id} item={item} category={category} loader={loader}
          artwork={artwork[item.fileName]}
          status={file?.state === "issue" ? "warning" : file?.state === "localOnly" ? "local" : undefined}
          note={<>
            {detail}
            {onChooseVersion && modId && group && group.length > 1 && group[0].fileName === item.fileName &&
              <button type="button" className="settings-action pack-resolve-action" data-pack-review-source={`duplicate:${modId}`}
                aria-label={`Choose version · ${item.name || modId}`}
                onClick={() => onChooseVersion({ modId, candidates: group })}>Choose version</button>}
            {onKeepLocal && localFile && <label className="pack-keep-local" title="Keep this file in your instance and leave it out of the release">
              <input type="checkbox" checked={!!localChoice} aria-label={`Keep local · ${item.fileName}`}
                onChange={event => onKeepLocal(localFile, event.currentTarget.checked)} />
              Keep local
            </label>}
          </>} />;
      })}
    </ul>
  </>;
}

function ReleasePreview({ report, inventory, checked, publication }: {
  report: PackCompatibility; inventory: Inventory; checked: Map<string, CheckedPackFile>;
  publication: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const delivered = categories.map(({ category, label }) => ({ category, label,
    files: inventory[category].filter(item => checked.get(packFileKey(category, item.fileName))?.state !== "localOnly") }));
  return <section className="pack-contents-review pack-release-preview" aria-label="First release">
    <h2 ref={heading} tabIndex={-1}>First release</h2>
    <dl className="pack-release-facts">
      <div><dt>Release</dt><dd>Version 1 · Unpublished</dd></div>
      <div><dt>Minecraft</dt><dd>{report.minecraftVersion}</dd></div>
      <div><dt>Loader</dt><dd>{report.loader} {report.loaderVersion}</dd></div>
    </dl>
    <PackLocalExclusions report={report} />
    {publication}
    {delivered.some(({ files }) => files.length) && <details className="pack-release-details">
      <summary>Files</summary>
      {delivered.filter(({ files }) => files.length > 0).map(({ category, label, files }) =>
      <section key={category} className="pack-contents-panel instance-content-list-shell" aria-label={label}>
        <h3>{label}</h3>
        <PackFileList instanceId={report.instanceId} category={category} label={label} loader={report.loader}
          files={files} checked={checked} />
      </section>)}
    </details>}
  </section>;
}

export function PackContentsReview({ instanceId, loader, runtime, basePublication, carriedDraft, onRefreshHead, setContentsBack, onPublished, onBusy, editor }: {
  instanceId: string; loader: string; runtime: string;
  onPublished: (publication: PackPublication) => void; onBusy: (busy: boolean) => void;
  setContentsBack?: (back: (() => void) | null) => void;
  basePublication?: PackPublication; carriedDraft?: ReleaseDraft; onRefreshHead: (draft: ReleaseDraft) => void;
  editor?: DraftEditing;
}) {
  const id = useId();
  const [inventory, setInventory] = useState<Result<Inventory>>(null);
  const [check, setCheck] = useState<Result<PackCompatibility>>(null);
  const [scanFiles, setScanFiles] = useState<ExcludedLocalPackFile[]>([]);
  const [localChoices, setLocalChoices] = useState<ExcludedLocalPackFile[]>([]);
  const [localChoiceNotice, setLocalChoiceNotice] = useState("");
  const [selected, setSelected] = useState(0);
  const [leaveFoldersOut, setLeaveFoldersOut] = useState(false);
  const simplePublish = !editor;
  const [editingContents, setEditingContents] = useState(false);
  const [fileReview, setFileReview] = useState<FileReview | null>(null);
  useEffect(() => { setFileReview(null); }, [runtime]);
  const draftKey = "delight-pack-draft:" + instanceId + ":" + (editor?.existing?.id ?? basePublication?.revision ?? 0);
  const [draft, setDraft] = useState<ReleaseDraft>(() => {
    if (carriedDraft) return carriedDraft;
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
      return { note: typeof saved?.note === "string" ? saved.note : editor?.existing?.note ?? "", required: saved?.required === true };
    } catch { return { note: editor?.existing?.note ?? "", required: false }; }
  });
  useEffect(() => {
    try {
      if (draft.note || draft.required) localStorage.setItem(draftKey, JSON.stringify(draft));
      else localStorage.removeItem(draftKey);
    } catch { /* The in-memory draft stays editable if storage is unavailable. */ }
  }, [draftKey, draft]);
  const setReleaseNote = (note: string) => setDraft(previous => ({ ...previous, note }));
  const published = (publication: PackPublication) => {
    try { localStorage.removeItem(draftKey); } catch { /* Publication is already confirmed. */ }
    onPublished(publication);
  };
  const chosen = categories[selected];
  const panelId = id + "-files";
  const tabs = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const inventorySection = useRef<HTMLElement>(null);
  const restoreFocusTo = useRef<string | null>(null);
  const jumpPending = useRef(false);
  const focusSelectedTab = () => tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });

  useLayoutEffect(() => { focusSelectedTab(); }, [instanceId, editingContents]);
  useLayoutEffect(() => {
    if (jumpPending.current) {
      jumpPending.current = false;
      panel.current?.querySelector<HTMLElement>(".pack-file-issue")?.focus();
    }
  }, [selected]);
  useLayoutEffect(() => {
    if (!fileReview || !setContentsBack) return;
    setContentsBack(() => {
      restoreFocusTo.current = fileReview.kind === "duplicate" ? `duplicate:${fileReview.choice.modId}` : "dependencies";
      setFileReview(null);
    });
    return () => setContentsBack(null);
  }, [fileReview, setContentsBack]);
  useLayoutEffect(() => {
    if (fileReview || restoreFocusTo.current === null) return;
    const triggers = inventorySection.current?.querySelectorAll<HTMLButtonElement>("button[data-pack-review-source]");
    const trigger = triggers && Array.from(triggers).find(button => button.dataset.packReviewSource === restoreFocusTo.current);
    restoreFocusTo.current = null;
    if (trigger) trigger.focus();
    else focusSelectedTab();
  }, [fileReview]);

  useEffect(() => {
    let active = true;
    setCheck(null);
    void readInventory(instanceId).then(
      value => { if (active) setInventory({ value }); },
      error => { if (active) setInventory({ error: error.message }); },
    );
    const assessment = simplePublish
      ? invoke<PackCompatibility>("preview_pack_publication", { instanceId })
      : invoke<PackCompatibility>("check_pack_compatibility", { instanceId, excludedLocalFiles: scanFiles });
    void assessment.then(
      value => {
        if (!active) return;
        const confirmed = value.excludedLocalFiles ?? [];
        setCheck({ value });
        setLocalChoices(confirmed);
        setLocalChoiceNotice(confirmed.length < scanFiles.length ? "Review local choices again for files that changed or can now be shared." : "");
      },
      error => { if (active) setCheck({ error: String(error) }); },
    );
    return () => { active = false; };
  }, [instanceId, runtime, scanFiles, simplePublish]);

  const groups = inventory && "value" in inventory ? inventory.value : null;
  const report = check && "value" in check ? check.value : null;
  const checked = useMemo(() => groups && report && matchCheckedFiles(instanceId, report, groups), [instanceId, report, groups]);
  const error = (inventory && "error" in inventory && inventory.error)
    || (check && "error" in check && check.error)
    || (groups && report && !checked && (report.issues.length
      ? "Some files could not be matched to this inventory. Review the issues below and try again."
      : "The instance files changed during the check. Try again to check the current files."));
  const blockedCategories = checked ? categories.filter(({ category }) =>
    groups?.[category].some(item => checked.get(packFileKey(category, item.fileName))?.state === "issue")) : [];
  const blocked = !!(report?.issues.length || blockedCategories.length);
  const needsFolderChoice = !simplePublish && !!report?.excludedFolders.length && !leaveFoldersOut;
  const confirmedChoices = report?.excludedLocalFiles ?? [];
  const localChoicesChanged = localChoices.length !== confirmedChoices.length ||
    localChoices.some(choice => !confirmedChoices.some(file => choice.fileName === file.fileName && choice.sha512 === file.sha512));
  const changeLocalChoice = (file: ExcludedLocalPackFile, keep: boolean) => {
    setLocalChoices(previous => {
      const otherFiles = previous.filter(choice => choice.fileName !== file.fileName);
      return keep ? [...otherFiles, file] : otherFiles;
    });
  };
  const retry = () => {
    focusSelectedTab();
    setInventory(null);
    setCheck(null);
    setLeaveFoldersOut(false);
    setLocalChoiceNotice("");
    setScanFiles([...localChoices]);
  };
  const jumpToIssue = (category: ContentCategory) => {
    const next = categories.findIndex(item => item.category === category);
    if (selected === next) panel.current?.querySelector<HTMLElement>(".pack-file-issue")?.focus();
    else { jumpPending.current = true; setSelected(next); }
  };
  const fileReviewResolved = () => {
    restoreFocusTo.current = "";
    setFileReview(null);
    retry();
  };
  if (fileReview?.kind === "duplicate") return <DuplicateResolutionPage choice={fileReview.choice}
    instanceId={instanceId} loader={loader} onBusy={onBusy} onResolved={fileReviewResolved} />;
  if (fileReview?.kind === "dependencies") return <DependencyReviewPage excludedLocalFiles={fileReview.excludedLocalFiles}
    instanceId={instanceId} loader={loader} onBusy={onBusy} onResolved={fileReviewResolved} />;
  if (basePublication && groups && report && checked && !blocked && !needsFolderChoice && !localChoicesChanged && !editingContents) {
    return <PackRevisionReview base={basePublication} report={report} required={draft.required} onNote={setReleaseNote}
      note={draft.note} onRequired={required => setDraft(previous => ({ ...previous, required }))}
      editor={editor && {...editor, onSaved: saved => {
        try { localStorage.removeItem(draftKey); } catch { /* The draft is already saved. */ }
        editor.onSaved(saved);
      }}} onBusy={onBusy} onPublished={published} onRecheck={retry} onRefreshHead={() => onRefreshHead(draft)}
      onReviewContents={() => setEditingContents(true)} />;
  }
  if (simplePublish && !basePublication && groups && report?.reviewToken && checked && !blocked && !localChoicesChanged) {
    return <ReleasePreview report={report} inventory={groups} checked={checked}
      publication={<PackPublicationForm report={report} note={draft.note} onNote={setReleaseNote}
        onBusy={onBusy} onPublished={published} onRecheck={retry} />} />;
  }

  return <section ref={inventorySection} className="pack-contents-review" aria-label="Pack contents review">
    <PackContentTabs id={id} selected={selected} onSelect={setSelected} tabsRef={tabs} />
    <div className="pack-source-check">
      {error ? <div className="pack-check-line">
        <p role="alert">Couldn’t finish the sharing check. {error}</p>
        <button type="button" className="settings-action" onClick={retry}><RefreshCw size={15} />Retry</button>
      </div> : !checked || !report ? <p role="status">{groups ? "Checking sharing compatibility…" : "Reading instance files…"}</p>
        : <>
          <div className="pack-check-line">
            <p role="status">{blocked ? "Needs attention" : "Ready to share"}</p>
            <div className="pack-check-actions">
              <button type="button" className="settings-action" onClick={retry}><RefreshCw size={15} aria-hidden="true" />
                {localChoicesChanged ? "Apply choices" : "Check again"}</button>
              {!!report.missingDependencies?.length && !localChoicesChanged && <button type="button" className="settings-action"
                data-pack-review-source="dependencies" onClick={() => setFileReview({
                  kind: "dependencies", excludedLocalFiles: [...confirmedChoices],
                })}>
                <PackagePlus size={15} aria-hidden="true" />Review dependencies
              </button>}
              {!blocked && !needsFolderChoice && !localChoicesChanged && basePublication && <button ref={reviewButton}
                type="button" className="settings-action" onClick={() => setEditingContents(false)}>
                Review changes<ArrowRight size={15} aria-hidden="true" />
              </button>}
            </div>
          </div>
          {blockedCategories.length > 0 && <div className="pack-issue-links">
            {blockedCategories.map(({ category, label }) => <button key={category} type="button"
              aria-label={`Show issues in ${label}`} onClick={() => jumpToIssue(category)}>{label}<ArrowRight size={13} /></button>)}
          </div>}
          {!simplePublish && report.excludedFolders.length > 0 && <div className="pack-folder-choice">
            <p id={id + "-excluded"}>Players would receive this pack without the contents of <strong>{report.excludedFolders.join(", ")}</strong>.</p>
            <label><input type="checkbox" checked={leaveFoldersOut} aria-describedby={id + "-excluded"}
              onChange={event => setLeaveFoldersOut(event.currentTarget.checked)} />Leave these folders out</label>
          </div>}
          {localChoiceNotice && <p className="pack-file-notice" role="status">{localChoiceNotice}</p>}
        </>}
      {report?.instanceId === instanceId && report.issues.length > 0 && <ul className="pack-instance-issues" aria-label="Instance issues">
        {report.issues.map(issue => <li key={issue}><CircleAlert size={15} aria-hidden="true" />{issue}</li>)}
      </ul>}
    </div>
    <div ref={panel} className="pack-contents-panel instance-content-list-shell" role="tabpanel" id={panelId} aria-labelledby={id + chosen.category} tabIndex={0}>
      {groups && <PackFileList instanceId={instanceId} category={chosen.category} label={chosen.label} loader={loader}
        files={groups[chosen.category]} checked={checked} localChoices={localChoices} onKeepLocal={simplePublish ? undefined : changeLocalChoice}
        onChooseVersion={choice => setFileReview({ kind: "duplicate", choice })} />}
    </div>
  </section>;
}
