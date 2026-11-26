import type { ReleaseManifest } from "./workspace-release-changes";

export type DraftSummary = {
  id: string;
  author: string;
  authorAvatarUrl?: string | null;
  baseRevision: number;
  note: string;
  state: "saved" | "submitted" | "returned" | "published";
  reviewNote: string;
  version: number;
  updatedAt: string;
  submittedAt: string | null;
  publishedRevision: number | null;
  canReview: boolean;
};

export type DraftDetail = DraftSummary & { manifest: ReleaseManifest };
export type DraftInbox = { role: "owner" | "edit"; ownerName?: string; headRevision: number; drafts: DraftSummary[] };
export type DraftAction = "submit" | "withdraw" | "return" | "publish" | "discard";
export type DraftEditing = {
  existing?: DraftSummary;
  canPublish: boolean;
  workingBaseRevision?: number;
  actionHost: HTMLDivElement | null;
  onSaved: (draft: DraftSummary) => void;
  onOpenLatest: (playerUrl: string, revision: number) => Promise<void>;
};
