export type PortalTarget = { kind: "server" | "world"; target: string };
export type PortalEntry = PortalTarget & {
  id: string;
  instanceId: string;
  instanceName: string;
  version: string;
  name: string;
  icon: string | null;
  lastPlayed: number | null;
  favorite: boolean;
  removable: boolean;
  unavailableReason: string | null;
};
export type PortalLibrary = { entries: PortalEntry[]; warnings: string[] };
export type PortalChange =
  | { action: "favorite"; id: string; favorite: boolean }
  | { action: "addServer"; instanceId: string; name: string; address: string }
  | { action: "remove"; id: string };
