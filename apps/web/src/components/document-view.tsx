'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Editor } from '@tiptap/react';
import {
  Download,
  FileText,
  History,
  ListTree,
  MessageSquare,
  PanelLeft,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import { documentToMarkdown } from '@collaby/editor';
import { can, type DocumentDetail } from '@collaby/shared';
import { CollabyEditor } from '@/components/editor/collaby-editor';
import { PresenceStack } from '@/components/editor/presence';
import { CommentsPanel } from '@/components/comments-panel';
import { HistoryPanel } from '@/components/history-panel';
import { SearchDialog, useGlobalSearch } from '@/components/search-dialog';
import { ShareDialog } from '@/components/share-dialog';
import { Popover } from '@/components/popover';
import { TocPanel } from '@/components/toc-panel';
import { Sidebar } from '@/components/sidebar';
import { Banner, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { documentFileName, downloadTextFile } from '@/lib/export-document';
import { useSession } from '@/lib/session';
import { useWorkspaces } from '@/lib/workspace-store';
import { useCollabDocument, type CollabIdentity } from '@/components/editor/use-collab-document';

const GUEST_IDENTITY: CollabIdentity = {
  userId: 'guest',
  displayName: 'Guest',
  avatarColor: '#7c9cff',
  avatarUrl: null,
};

type Panel = 'none' | 'comments' | 'history' | 'toc';

function writeLeadingHeading(editor: Editor | null, title: string): void {
  if (!editor || editor.isDestroyed || !editor.isEditable) return;

  const heading = editor.state.doc.firstChild;
  if (!heading || heading.type.name !== 'heading' || heading.attrs.level !== 1) return;
  if (heading.textContent === title) return;

  editor
    .chain()
    .insertContentAt({ from: 1, to: heading.nodeSize - 1 }, title)
    .run();
}

export function DocumentView({
  documentId,
  shareToken,
}: {
  documentId: string;
  shareToken: string | null;
}) {
  const router = useRouter();
  const user = useSession((state) => state.user);
  const { loadWorkspaces, loadDocuments, renameDocument, rememberLocation } = useWorkspaces();

  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [sharing, setSharing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const search = useGlobalSearch();
  const [title, setTitle] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<{ anchorId: string; quotedText: string } | null>(
    null,
  );
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);

  const identity = useMemo<CollabIdentity>(
    () =>
      user
        ? {
            userId: user.id,
            displayName: user.displayName,
            avatarColor: user.avatarColor,
            avatarUrl: user.avatarUrl,
          }
        : GUEST_IDENTITY,
    [user],
  );

  const { provider, status, peers } = useCollabDocument(documentId, identity, shareToken);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);

    api
      .get<DocumentDetail>(`/api/documents/${documentId}`, {
        query: shareToken ? { shareToken } : undefined,
      })
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setTitle(result.title);
      })
      .catch(() => {
        if (!cancelled) setError('This page is not available to you.');
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, shareToken]);

  const userId = user?.id ?? null;
  const detailId = detail?.id ?? null;
  const detailWorkspaceId = detail?.workspaceId ?? null;
  const detailIsFolder = detail?.isFolder ?? false;

  useEffect(() => {
    if (!userId || !detailId || !detailWorkspaceId) return;

    void loadWorkspaces().then((workspaces) => {
      const isMember = workspaces.some((workspace) => workspace.id === detailWorkspaceId);
      if (!isMember) return;

      void loadDocuments(detailWorkspaceId);
      rememberLocation(detailWorkspaceId, detailIsFolder ? null : detailId);
    });
  }, [
    userId,
    detailId,
    detailWorkspaceId,
    detailIsFolder,
    loadWorkspaces,
    loadDocuments,
    rememberLocation,
  ]);

  useEffect(() => {
    if (!detail) return;

    const previous = document.title;
    document.title = detail.title ? `${detail.title} · Collaby` : 'Collaby';

    return () => {
      document.title = previous;
    };
  }, [detail?.title, detail]);

  const commitTitle = useCallback(async () => {
    if (!detail || title.trim().length === 0 || title === detail.title) return;

    const next = title.trim();
    await renameDocument(detail.id, next);
    setDetail({ ...detail, title: next });
    writeLeadingHeading(editor, next);
  }, [detail, title, renameDocument, editor]);

  const adoptHeadingTitle = useCallback(
    (heading: string) => {
      setDetail((current) => {
        if (!current || current.title === heading) return current;
        void renameDocument(current.id, heading);
        setTitle(heading);
        return { ...current, title: heading };
      });
    },
    [renameDocument],
  );

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-[360px]">
          <Banner>{error}</Banner>
        </div>
      </main>
    );
  }

  if (!detail || !provider) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  const canEdit = can(detail.access.role, 'document.edit');
  const canComment = can(detail.access.role, 'document.comment') && Boolean(user);
  function exportMarkdown() {
    if (!editor) return;

    const markdown = documentToMarkdown(editor.state.doc);
    downloadTextFile(documentFileName(title, 'md'), markdown, 'text/markdown');
  }

  const canShare = can(detail.access.role, 'document.share');
  const canSeeHistory = can(detail.access.role, 'document.history.read');

  return (
    <div className="flex h-dvh overflow-hidden">
      {user ? (
        <div className="hidden md:flex">
          <Sidebar activeDocumentId={documentId} onOpenSearch={() => search.setOpen(true)} />
        </div>
      ) : null}

      {user && navOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="h-full">
            <Sidebar
              activeDocumentId={documentId}
              onOpenSearch={() => {
                setNavOpen(false);
                search.setOpen(true);
              }}
              onNavigate={() => setNavOpen(false)}
            />
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="flex h-full flex-1 items-start justify-start bg-night-900/70 p-3 backdrop-blur-sm"
          >
            <X size={18} className="text-haze" />
          </button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-night-600 px-4">
          {user ? (
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
              className="-ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon md:hidden"
            >
              <PanelLeft size={15} />
            </button>
          ) : null}

          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              disabled={!canEdit}
              aria-label="Page title"
              placeholder="Untitled"
              title={canEdit ? 'Click to rename this page' : undefined}
              className="w-[calc(100%+12px)] -mx-1.5 truncate rounded-md bg-transparent px-1.5 py-1 text-[14px] font-medium text-moon outline-none transition-colors placeholder:text-dusk hover:bg-night-750 focus:bg-night-800 focus:ring-1 focus:ring-lull-400/60 disabled:cursor-default disabled:hover:bg-transparent"
            />
          </div>

          <span
            title={status === 'connected' ? 'Live' : 'Reconnecting'}
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              status === 'connected' ? 'bg-leaf' : 'bg-lamp',
            )}
          />

          <PresenceStack peers={peers} />

          {!canEdit ? (
            <span className="rounded border border-night-600 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-dusk">
              {detail.access.role}
            </span>
          ) : null}

          <button
            type="button"
            aria-label="Contents"
            title="Contents"
            onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              panel === 'toc'
                ? 'bg-night-700 text-moon'
                : 'text-dusk hover:bg-night-700 hover:text-moon',
            )}
          >
            <ListTree size={14} />
          </button>

          {canSeeHistory ? (
            <button
              type="button"
              aria-label="Version history"
              title="Version history"
              onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md',
                panel === 'history'
                  ? 'bg-night-700 text-moon'
                  : 'text-dusk hover:bg-night-700 hover:text-moon',
              )}
            >
              <History size={14} />
            </button>
          ) : null}

          <button
            type="button"
            aria-label="Comments"
            title="Comments"
            onClick={() => setPanel(panel === 'comments' ? 'none' : 'comments')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              panel === 'comments'
                ? 'bg-night-700 text-moon'
                : 'text-dusk hover:bg-night-700 hover:text-moon',
            )}
          >
            <MessageSquare size={14} />
          </button>

          <Popover
            align="end"
            className="w-[168px]"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                aria-label="Export"
                title="Export"
                onClick={toggle}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  open ? 'bg-night-700 text-moon' : 'text-dusk hover:bg-night-700 hover:text-moon',
                )}
              >
                <Download size={14} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="grid gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    exportMarkdown();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-haze transition-colors hover:bg-night-750 hover:text-moon"
                >
                  <FileText size={12} />
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    window.requestAnimationFrame(() => window.print());
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-haze transition-colors hover:bg-night-750 hover:text-moon"
                >
                  <Printer size={12} />
                  PDF
                </button>
              </div>
            )}
          </Popover>

          {canShare ? (
            <button
              type="button"
              aria-label="Share"
              title="Share"
              onClick={() => setSharing(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
            >
              <Share2 size={14} />
            </button>
          ) : null}
        </header>

        <div ref={scrollRef} data-print-root className="min-h-0 flex-1 overflow-y-auto">
          <CollabyEditor
            documentId={documentId}
            workspaceId={detail.workspaceId}
            provider={provider}
            editable={canEdit}
            canComment={canComment}
            identity={identity}
            peers={peers}
            onEditorReady={setEditor}
            onCommentRequest={(anchorId, quotedText) => {
              setDraftAnchor({ anchorId, quotedText });
              setPanel('comments');
            }}
            onCommentSelect={(anchorId) => {
              setActiveAnchorId(anchorId);
              setPanel('comments');
            }}
            onNavigate={(target) => router.push(`/d/${target}`)}
            onHeadingTitle={adoptHeadingTitle}
          />
        </div>
      </div>

      {panel === 'toc' ? (
        <div className="fixed inset-0 z-40 lg:static lg:inset-auto lg:z-auto lg:flex">
          <TocPanel editor={editor} scrollRef={scrollRef} onClose={() => setPanel('none')} />
        </div>
      ) : null}

      {panel === 'comments' ? (
        <div className="fixed inset-0 z-40 lg:static lg:inset-auto lg:z-auto lg:flex">
          <CommentsPanel
            documentId={documentId}
            canComment={canComment}
            activeAnchorId={activeAnchorId}
            draftAnchor={draftAnchor}
            onClose={() => setPanel('none')}
            onDraftResolved={() => setDraftAnchor(null)}
          />
        </div>
      ) : null}

      {panel === 'history' ? (
        <div className="fixed inset-0 z-40 lg:static lg:inset-auto lg:z-auto lg:flex">
          <HistoryPanel
            documentId={documentId}
            canRestore={can(detail.access.role, 'document.history.restore')}
            onClose={() => setPanel('none')}
            onRestored={() => window.location.reload()}
          />
        </div>
      ) : null}

      {user ? (
        <SearchDialog
          open={search.open}
          workspaceId={detail.workspaceId}
          onClose={() => search.setOpen(false)}
        />
      ) : null}

      {sharing ? (
        <ShareDialog
          documentId={documentId}
          documentTitle={detail.title}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </div>
  );
}
