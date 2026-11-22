import { useState, type ReactNode } from "react";
import { Check, ExternalLink, Plus, Timer } from "lucide-react";

export function CatalogArtwork({ source, embedded, fallback }: {
  source?: string | null; embedded?: string | null; fallback: ReactNode;
}) {
  // Remount the image when its candidate changes, including after switching packs.
  const local = embedded && embedded !== source ? <ArtworkImage key={embedded} src={embedded} fallback={fallback} /> : fallback;
  return source ? <ArtworkImage key={source} src={source} fallback={local} /> : <>{local}</>;
}

function ArtworkImage({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return failed ? <>{fallback}</> : <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

type Props = {
  title: string;
  icon?: string | null;
  fallback: ReactNode;
  subtitle: string;
  loader: string;
  detail: string;
  installed: boolean;
  pending: boolean;
  restriction?: string | null;
  detailLabel?: string;
  openDetails: () => void;
  openProject: () => void;
  install: () => void;
};
export function CatalogFeedRow({
  title,
  icon,
  fallback,
  subtitle,
  loader,
  detail,
  installed,
  pending,
  restriction,
  detailLabel,
  openDetails,
  openProject,
  install,
}: Props) {
  return (
    <div className="catalog-item catalog-result instance-list-row" data-installed={installed || undefined}>
      <button type="button" className="catalog-result-title content-detail-hitarea" onClick={openDetails} aria-label={detailLabel ?? `Open details for ${title}`}>
        <span className="content-icon"><CatalogArtwork source={icon} fallback={fallback} /></span>
        <span className="content-name"><b>{title}</b><small className="content-metadata"><span title={subtitle}>{subtitle}</span>{loader && <><i aria-hidden="true" /><span>{loader}</span></>}<i aria-hidden="true" /><span>{detail}</span></small></span>
      </button>
      <span className="catalog-result-status">{installed ? <><Check size={16}/>Installed</> : pending ? <><Timer size={15}/>Queued</> : null}</span>
      <button type="button" className="catalog-result-project" onClick={openProject} aria-label={`View ${title} on Modrinth`} title="View on Modrinth"><ExternalLink size={16} /></button>
      <button type="button" className="catalog-install catalog-result-add" disabled={installed || pending || Boolean(restriction)} title={restriction ?? undefined} onClick={install}
        aria-label={installed ? `${title} is installed` : pending ? `${title} is queued for installation` : restriction ? `${title}: ${restriction}` : `Install ${title}`}>
        <Plus size={16}/>Add
      </button>
    </div>
  );
}
