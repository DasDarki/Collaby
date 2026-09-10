'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, FileText, Search } from 'lucide-react';
import type { SearchHit } from '@collaby/shared';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export function useGlobalSearch(): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { open, setOpen };
}

export function SearchDialog({
  open,
  workspaceId,
  onClose,
}: {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [scoped, setScoped] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setHits([]);
    setSelected(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const term = query.trim();
    if (term.length === 0) {
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      api
        .get<SearchHit[]>('/api/search', {
          query: { q: term, workspaceId: scoped && workspaceId ? workspaceId : undefined },
          signal: controller.signal,
        })
        .then((results) => {
          setHits(results);
          setSelected(0);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 160);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, scoped, workspaceId]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openHit = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      onClose();
      router.push(`/d/${hit.id}`);
    },
    [onClose, router],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search pages"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-night-900/75 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-night-600 bg-night-800 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-night-600 px-4">
          <Search size={15} className="shrink-0 text-dusk" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, Math.max(0, hits.length - 1)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                openHit(hits[selected]);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            autoFocus
            placeholder="Search every page you can open"
            aria-label="Search query"
            className="h-12 flex-1 bg-transparent text-[14px] text-moon placeholder:text-dusk focus:outline-none"
          />
          {loading ? <Spinner /> : null}
        </div>

        {workspaceId ? (
          <div className="flex items-center gap-1.5 border-b border-night-600 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setScoped(false)}
              className={cn(
                'rounded px-2 py-0.5 text-[11.5px] transition-colors',
                scoped ? 'text-dusk hover:text-moon' : 'bg-night-700 text-moon',
              )}
            >
              Everywhere
            </button>
            <button
              type="button"
              onClick={() => setScoped(true)}
              className={cn(
                'rounded px-2 py-0.5 text-[11.5px] transition-colors',
                scoped ? 'bg-night-700 text-moon' : 'text-dusk hover:text-moon',
              )}
            >
              This workspace
            </button>
          </div>
        ) : null}

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {hits.length === 0 ? (
            <li className="px-3 py-8 text-center text-[12.5px] text-dusk">
              {query.trim().length === 0
                ? 'Type to search page titles and contents.'
                : loading
                  ? 'Searching'
                  : 'Nothing matched that.'}
            </li>
          ) : (
            hits.map((hit, index) => (
              <li key={hit.id} data-index={index}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => openHit(hit)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors',
                    index === selected ? 'bg-night-700' : 'hover:bg-night-750',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 text-dusk">
                      {hit.icon ? (
                        <span className="text-[13px]">{hit.icon}</span>
                      ) : (
                        <FileText size={13} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-moon">
                      {hit.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-dusk">{hit.workspaceName}</span>
                    {index === selected ? (
                      <CornerDownLeft size={11} className="shrink-0 text-dusk" />
                    ) : null}
                  </span>

                  {hit.snippet.length > 0 ? (
                    <span className="line-clamp-2 pl-[21px] text-[12px] leading-relaxed text-haze">
                      {hit.snippet.map((part, partIndex) =>
                        part.match ? (
                          <mark
                            key={partIndex}
                            className="rounded-[2px] bg-lull-400/25 px-0.5 text-lull-300"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <span key={partIndex}>{part.text}</span>
                        ),
                      )}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="flex items-center gap-3 border-t border-night-600 px-4 py-1.5 font-mono text-[10.5px] text-dusk">
          <span>up down to move</span>
          <span>enter to open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
