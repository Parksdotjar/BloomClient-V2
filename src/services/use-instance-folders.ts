import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "./invoke";

type LibraryFolder = { id: string; name: string; instanceIds: string[] };
export type FolderChange = { action: "create"; name: string; instanceIds: string[] } | { action: "rename"; folderId: string; name: string } | { action: "move"; instanceId: string; folderId: string | null } | { action: "reorder"; folderId: string; targetId: string; after: boolean } | { action: "dissolve"; folderId: string };

export function useInstanceFolders(libraryKey: string | null) {
  const [snapshot, setSnapshot] = useState<LibraryFolder[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // Native reads and writes must publish in the same order they were requested.
  const tail = useRef(Promise.resolve());
  const request = useCallback((change?: FolderChange) => {
    const result = tail.current.then(async () => {
      try {
        const folders = change
          ? await invoke<LibraryFolder[]>("change_instance_folder", { change })
          : await invoke<LibraryFolder[]>("list_instance_folders");
        if (!Array.isArray(folders)) throw new Error("Delight could not confirm the folder layout. Please retry.");
        setSnapshot(folders);
        setError("");
        return folders;
      } catch (cause) {
        setError(String(cause));
        return null;
      }
    });
    tail.current = result.then(() => {});
    return result;
  }, []);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (libraryKey === null || libraryKey === lastKey.current) return;
    lastKey.current = libraryKey;
    void request();
  }, [libraryKey, request]);
  const save = async (change: FolderChange) => {
    if (saving.current || snapshot === null) return null;
    saving.current = true;
    setBusy(true);
    try { return await request(change); }
    finally { saving.current = false; setBusy(false); }
  };
  return { snapshot, error, busy, refresh: () => request(), save };
}
export type InstanceFolderCache = ReturnType<typeof useInstanceFolders>;
