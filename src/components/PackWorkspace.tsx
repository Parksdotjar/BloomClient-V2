import { useId, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type Ref, type RefObject } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Cuboid, Share2 } from "lucide-react";
import { CatalogArtwork } from "./CatalogFeedRow";
import "./pack-workspace.css";

export type WorkspaceInstance = {
  id: string;
  name: string;
  icon?: string | null;
  version: string;
  loader: string;
  loaderVersion?: string | null;
  directory: string;
};

const pages = { overview: "Overview", changes: "Changes", drafts: "Drafts", review: "Review", releases: "Releases", access: "Access" } as const;
export type WorkspacePage = keyof typeof pages;

type InstanceSelect = ComponentType<{
  value: string;
  options: string[];
  onChange: (id: string) => void;
  ariaLabel: string;
  menuOwner: string;
  menuWidthRef: RefObject<HTMLElement | null>;
  showCheckmark: boolean;
  renderOption: (id: string) => ReactNode;
}>;

function PackArtwork({ instance }: { instance: WorkspaceInstance }) {
  return <span className="pack-workspace-art" aria-hidden="true">
    <CatalogArtwork source={instance.icon} fallback={<Cuboid strokeWidth={1.6} />} />
  </span>;
}

function WorkspaceNavGroup({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const group = useId();
  const [expanded, setExpanded] = useState(true);
  return <>
    <button type="button" className="pack-workspace-group" aria-controls={group} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}>
      {icon}<span>{label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    <ul id={group} hidden={!expanded}>{children}</ul>
  </>;
}

export function PackWorkspaceSidebar({ instances, instance, page, destinations, onNavigate, onSelect, onBack, SelectControl, sidebarRef }: {
  instances: WorkspaceInstance[];
  instance: WorkspaceInstance;
  page: WorkspacePage;
  destinations: WorkspacePage[];
  onNavigate: (page: WorkspacePage) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  SelectControl: InstanceSelect;
  sidebarRef: RefObject<HTMLElement | null>;
}) {
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  const byId = new Map(instances.map(item => [item.id, item]));
  const nameCounts = new Map<string, number>();
  for (const item of instances) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);

  return <div className="pack-workspace-sidebar">
    <button ref={back} type="button" className="pack-workspace-back" onClick={onBack}>
      <ArrowLeft size={17} aria-hidden="true" />Back
    </button>
    <SelectControl value={instance.id} options={instances.map(item => item.id)} onChange={onSelect}
      ariaLabel={`Switch workspace instance: ${instance.name}`} menuOwner="pack-workspace" menuWidthRef={sidebarRef} showCheckmark={false}
      renderOption={id => {
        const item = byId.get(id);
        return item && <span className="pack-workspace-choice" title={item.name}>
          <PackArtwork instance={item} />
          <span className="pack-workspace-choice-text"><b>{item.name}</b>
            <small title={item.directory}>{(nameCounts.get(item.name) ?? 0) > 1 ? item.id : `${item.version} · ${item.loader}`}</small>
          </span>
        </span>;
      }} />
    <nav className="pack-workspace-nav" aria-label="Pack Workspace pages">
      <WorkspaceNavGroup label="Sharing" icon={<Share2 size={16} aria-hidden="true"/>}>
        {destinations.map(key => <li key={key}><button type="button" aria-current={key === page ? "page" : undefined}
          onClick={() => onNavigate(key)}>{pages[key]}</button></li>)}
      </WorkspaceNavGroup>
    </nav>
  </div>;
}

export function WorkspaceFrame({ instance, label, page, action, actionHost, children }: {
  instance: WorkspaceInstance;
  label: string;
  page?: WorkspacePage;
  action?: ReactNode;
  actionHost?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return <section className="instance-workspace pack-workspace-overview" aria-label={label}>
    <div className="desktop-breadcrumb"><Cuboid size={16} aria-hidden="true" />Instances
      <ChevronRight size={13} aria-hidden="true" /><strong>Pack Workspace</strong>
      {page && <><ChevronRight size={13} aria-hidden="true" /><span>{pages[page]}</span></>}
    </div>
    <header className="instance-hero-panel">
      <div className="instance-hero-main">
        <div className="instance-identity">
          <PackArtwork instance={instance} />
          <div><h1>{instance.name}</h1>
            <p>Minecraft {instance.version} · {instance.loader}{instance.loaderVersion && ` ${instance.loaderVersion}`}</p>
          </div>
        </div>
        {(action || actionHost) && <div className="instance-hero-actions" ref={actionHost}>{action}</div>}
      </div>
    </header>
    {children}
  </section>;
}
