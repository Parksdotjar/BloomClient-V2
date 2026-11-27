import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CubeIcon as Cuboid, PackageIcon as PackageOpen, PuzzlePieceIcon as Puzzle } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { CatalogArtwork } from "./CatalogFeedRow";
import { formatBytes } from "../services/format-bytes";

export type ContentCategory = "mods" | "resourcepacks" | "shaderpacks";
export type InstanceContentItem = { id: string; name: string; version: string; fileName: string; size: number; enabled: boolean; icon?: string | null };

export function usePackArtwork(instanceId: string, category: ContentCategory | "settings", items?: InstanceContentItem[], forSharing = false) {
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const fileKey = (category === "resourcepacks" || category === "shaderpacks") && items?.length
    ? JSON.stringify(items.map(item => [item.fileName, item.size])) : "";
  useEffect(() => {
    let current = true;
    setArtwork({});
    if (fileKey) {
      void invoke<Record<string, string>>("get_pack_artwork", { instanceId, category, forSharing })
        .then(images => { if (current) setArtwork(images ?? {}); }).catch(() => {});
    }
    return () => { current = false; };
  }, [instanceId, category, fileKey, forSharing]);
  return artwork;
}

type Props = {
  item: Omit<InstanceContentItem, "size"> & { size?: number };
  category: ContentCategory;
  loader: string;
  artwork?: string;
  note?: ReactNode;
  status?: "warning" | "local";
  interaction?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onPointerDown" | "aria-label">;
  children?: ReactNode;
};

export function InstalledContentRow({ item, category, loader, artwork, interaction, note, status, children }: Props) {
  const Kind = category === "mods" ? Puzzle : category === "shaderpacks" ? Cuboid : PackageOpen;
  const statusLabel = status === "warning" ? "Needs attention" : status === "local" ? "Kept local" : item.enabled ? "Enabled" : "Disabled";
  const identity = <>
    <span className="content-icon"><CatalogArtwork source={artwork} embedded={item.icon} fallback={<Kind size={22} aria-hidden="true" />} /></span>
    <span className="content-name">
      <b title={item.fileName}>{item.name || item.fileName}</b>
      <small className="content-metadata">
        <span>{item.version || item.fileName}</span>
        <i aria-hidden="true" />
        <span>{category === "mods" ? loader : category === "resourcepacks" ? "Minecraft" : "Shader"}</span>
        {item.size !== undefined && <><i aria-hidden="true" /><span>{formatBytes(item.size)}</span></>}
      </small>
      {note}
    </span>
  </>;
  const Row = interaction ? "div" : "li";
  return <Row className="content-item installed-content-item instance-list-row">
    {interaction ? <button type="button" className="content-detail-hitarea" draggable={false}
      onDragStart={event => event.preventDefault()} {...interaction}>{identity}</button>
      : <div className="content-detail-hitarea">{identity}</div>}
    <div className="content-row-actions">{children ?? <span className="content-status-dot" data-enabled={item.enabled} data-status={status}
      role="img" aria-label={statusLabel} title={statusLabel} />}</div>
  </Row>;
}
