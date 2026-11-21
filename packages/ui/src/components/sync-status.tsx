"use client";

import { useT } from "./language";
import { Link } from "../navigation";
import { useSyncIndicatorHidden } from "../client/sync-indicator";

export function SyncStatus({ state, label, href }: { state: string; label: string; href: string }) {
  const t = useT();
  const hidden = useSyncIndicatorHidden();
  if (hidden) return null;
  return (
    <Link className="sync-status" data-sync={state} href={href} aria-label={t("{0}. Abrir ajustes", [label])}>
      <span className="sync-status-label" aria-hidden="true">{label}</span>
    </Link>
  );
}
