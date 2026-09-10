'use client';

import { useEffect, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import type { RevisionSummary } from '@collaby/shared';
import { Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export function HistoryPanel({
  documentId,
  canRestore,
  onClose,
  onRestored,
}: {
  documentId: string;
  canRestore: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ oid: string; markdown: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<RevisionSummary[]>(`/api/documents/${documentId}/revisions`)
      .then(setRevisions)
      .finally(() => setLoading(false));
  }, [documentId]);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-night-600 bg-night-850 lg:w-[320px]">
      <div className="flex h-12 items-center justify-between border-b border-night-600 px-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-moon">
          <History size={13} className="text-dusk" />
          Version history
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : revisions.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-dusk">
            No versions committed yet. Edits are committed to git a short while after you stop
            typing.
          </p>
        ) : (
          <ol className="space-y-1">
            {revisions.map((revision) => (
              <li key={revision.oid}>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await api.get<{ oid: string; markdown: string }>(
                      `/api/documents/${documentId}/revisions/${revision.oid}`,
                    );
                    setPreview(result);
                  }}
                  className={cn(
                    'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                    preview?.oid === revision.oid ? 'bg-night-700' : 'hover:bg-night-750',
                  )}
                >
                  <p className="truncate text-[12.5px] text-moon">{revision.message}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-dusk">
                    {revision.oid.slice(0, 7)} · {new Date(revision.committedAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {preview ? (
        <div className="border-t border-night-600 p-2.5">
          <pre className="max-h-[240px] overflow-auto rounded-md border border-night-600 bg-night-900 p-2.5 font-mono text-[11.5px] leading-relaxed text-haze">
            {preview.markdown}
          </pre>

          {canRestore ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={async () => {
                await api.post(`/api/documents/${documentId}/revisions/${preview.oid}/restore`);
                onRestored();
              }}
            >
              <RotateCcw size={12} />
              Restore this version
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
