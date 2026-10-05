import { invoke } from "@tauri-apps/api/core";

export type BackendCapabilities = {
  catalog: boolean;
  modrinth: boolean;
  curseforge: boolean;
  modpacks: boolean;
  cosmetics?: boolean;
};

export type BackendStatus = {
  service: string;
  status: string;
  apiVersion: string;
  capabilities: BackendCapabilities;
  timestamp: string;
};

export const getBackendStatus = () => invoke<BackendStatus>("get_backend_status");

export const monitorBackend = (onChange: (status: BackendStatus | null) => void) => {
  let stopped = false;
  const refresh = async () => {
    try {
      const status = await getBackendStatus();
      if (!stopped) onChange(status);
    } catch {
      if (!stopped) onChange(null);
    }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 60_000);
  return () => { stopped = true; window.clearInterval(timer); };
};
