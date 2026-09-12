'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Folder, RotateCcw } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

export interface TrashEntry {
  id: string;
  title: string;
  isFolder: boolean;
  deletedAt: string;
  childCount: number;
}

export async function loadTrash(workspaceId: string): Promise<TrashEntry[]> {
  return api.get<TrashEntry[]>(`/api/workspaces/${workspaceId}/trash`);
}

export function TrashDialog({
  workspaceId,
  onClose,
  onRestored,
}: {
  workspaceId: string;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await loadTrash(workspaceId));
    } catch {
      setError('Could not load the trash');
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function restore(entry: TrashEntry) {
    setRestoring(entry.id);
    setError(null);

    try {
      await api.post(`/api/documents/${entry.id}/restore`);
      setEntries((current) => current?.filter((row) => row.id !== entry.id) ?? null);
      await onRestored();
    } catch {
      setError(`Could not restore "${entry.title}"`);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trash"
      className="fixed inset-0 z-[70] flex items-start justify-center bg-night-900/75 px-5 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-full max-w-[440px] flex-col rounded-xl border border-night-600 bg-night-800 shadow-2xl shadow-black/60"
      >
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-[14px] font-medium text-moon">Trash</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-dusk">
            Deleted pages stay here. Restoring a folder brings back everything deleted with it.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {entries === null ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-dusk">Loading</p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-dusk">Nothing deleted yet.</p>
          ) : (
            <ul className="grid gap-0.5">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-haze hover:bg-night-750"
                >
                  <span className="shrink-0 text-dusk">
                    {entry.isFolder ? <Folder size={13} /> : <FileText size={13} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.title}
                    {entry.childCount > 0 ? (
                      <span className="text-dusk"> +{entry.childCount} inside</span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoring !== null}
                    onClick={() => void restore(entry)}
                  >
                    {restoring === entry.id ? <Spinner /> : <RotateCcw size={12} />}
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="px-5 pb-2 text-[12.5px] text-alarm">{error}</p> : null}

        <div className="flex justify-end border-t border-night-600 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
