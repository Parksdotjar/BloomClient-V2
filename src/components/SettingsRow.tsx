import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

export function SettingsRow({ title, description, leading, children }: {
  title: string;
  description: string;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return <div className="setting-row" data-setting-help={description}>
    <span className="setting-label">{leading}<b>{title}</b></span>
    {children}
    <InfoTip label={title}>{description}</InfoTip>
  </div>;
}
