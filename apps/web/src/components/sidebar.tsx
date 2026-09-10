'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import type { WorkspaceSummary } from '@collaby/shared';
import { Popover } from '@/components/popover';
import { Avatar, Button, Input } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';
import { cn } from '@/lib/cn';
import {
  dropModeFromPointer,
  canDrop,
  resolveDrop,
  resolveRootDrop,
  type DropTarget,
} from '@/lib/tree-drop';
import { buildDocumentTree, useWorkspaces, type DocumentTreeNode } from '@/lib/workspace-store';
import { useSession } from '@/lib/session';

const DRAG_THRESHOLD = 6;
const TOUCH_HOLD_MS = 420;
const HOVER_EXPAND_MS = 700;

type DropProbe =
  | { kind: 'row'; target: DropTarget }
  | { kind: 'empty' }
  | { kind: 'blocked' }
  | { kind: 'outside' };

interface DragState {
  documentId: string;
  title: string;
  x: number;
  y: number;
}

interface RowActions {
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string, isFolder: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (node: DocumentTreeNode) => void;
  onNavigate?: (() => void) | undefined;
  onDragStart: (event: React.PointerEvent, node: DocumentTreeNode) => void;
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] transition-colors',
        danger ? 'text-alarm hover:bg-alarm/10' : 'text-haze hover:bg-night-750 hover:text-moon',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TreeRow({
  node,
  activeId,
  collapsed,
  drag,
  dropTarget,
  renaming,
  setRenaming,
  actions,
}: {
  node: DocumentTreeNode;
  activeId: string | null;
  collapsed: Set<string>;
  drag: DragState | null;
  dropTarget: DropTarget | null;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  actions: RowActions;
}) {
  const isOpen = !collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeId;
  const isDragging = drag?.documentId === node.id;
  const target = dropTarget?.documentId === node.id ? dropTarget.mode : null;
  const [draft, setDraft] = useState(node.title);

  useEffect(() => {
    if (renaming === node.id) setDraft(node.title);
  }, [renaming, node.id, node.title]);

  const icon = node.isFolder ? (
    isOpen ? (
      <FolderOpen size={13} />
    ) : (
      <Folder size={13} />
    )
  ) : node.icon ? (
    <span className="text-[13px]">{node.icon}</span>
  ) : (
    <FileText size={13} />
  );

  function commitRename() {
    const next = draft.trim();
    setRenaming(null);
    if (next.length > 0 && next !== node.title) actions.onRename(node.id, next);
  }

  return (
    <>
      <div
        data-doc-id={node.id}
        className={cn(
          'group relative flex h-7 items-center gap-1 rounded-md pr-1 transition-colors',
          isActive ? 'bg-night-700 text-moon' : 'text-haze hover:bg-night-750 hover:text-moon',
          isDragging && 'opacity-40',
          target === 'inside' && 'bg-lull-400/15 ring-1 ring-inset ring-lull-400/60',
        )}
        style={{ paddingLeft: 4 + node.depth * 12 }}
      >
        {target === 'before' || target === 'after' ? (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-lull-400',
              target === 'before' ? '-top-px' : '-bottom-px',
            )}
            style={{ marginLeft: 4 + node.depth * 12 }}
          />
        ) : null}

        <button
          type="button"
          aria-label={`Reorder ${node.title}`}
          onPointerDown={(event) => actions.onDragStart(event, node)}
          className="flex h-5 w-3 shrink-0 cursor-grab touch-none items-center justify-center text-dusk opacity-0 transition-opacity hover:text-moon group-hover:opacity-100 active:cursor-grabbing [@media(hover:none)]:opacity-100"
        >
          <GripVertical size={11} />
        </button>

        <button
          type="button"
          aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
          onClick={() => actions.onToggle(node.id)}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded text-dusk transition-transform',
            hasChildren || node.isFolder ? 'hover:text-moon' : 'invisible',
            isOpen && 'rotate-90',
          )}
        >
          <ChevronRight size={12} />
        </button>

        {renaming === node.id ? (
          <input
            value={draft}
            autoFocus
            aria-label={`Rename ${node.title}`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenaming(null);
            }}
            className="h-5 min-w-0 flex-1 rounded border border-lull-400 bg-night-900 px-1 text-[13px] text-moon outline-none"
          />
        ) : node.isFolder ? (
          <button
            type="button"
            onClick={() => actions.onToggle(node.id)}
            onDoubleClick={() => setRenaming(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px]"
          >
            <span className="shrink-0 text-dusk">{icon}</span>
            <span className="truncate">{node.title}</span>
          </button>
        ) : (
          <Link
            href={`/d/${node.id}`}
            onClick={actions.onNavigate}
            onDoubleClick={(event) => {
              event.preventDefault();
              setRenaming(node.id);
            }}
            draggable={false}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"
          >
            <span className="shrink-0 text-dusk">{icon}</span>
            <span className="truncate">{node.title}</span>
          </Link>
        )}

        <Popover
          align="end"
          className="w-[176px]"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-label={`Actions for ${node.title}`}
              onClick={toggle}
              className={cn(
                'h-5 w-5 shrink-0 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-moon',
                open ? 'flex' : 'hidden group-hover:flex',
              )}
            >
              <MoreHorizontal size={13} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="grid gap-0.5">
              <MenuItem
                icon={<Pencil size={12} />}
                label="Rename"
                onClick={() => {
                  close();
                  setRenaming(node.id);
                }}
              />
              <MenuItem
                icon={<Plus size={12} />}
                label="Page inside"
                onClick={() => {
                  close();
                  actions.onCreateChild(node.id, false);
                }}
              />
              <MenuItem
                icon={<FolderPlus size={12} />}
                label="Folder inside"
                onClick={() => {
                  close();
                  actions.onCreateChild(node.id, true);
                }}
              />
              <span className="my-0.5 h-px bg-night-600" />
              <MenuItem
                icon={<Trash2 size={12} />}
                label="Delete"
                danger
                onClick={() => {
                  close();
                  actions.onDelete(node);
                }}
              />
            </div>
          )}
        </Popover>
      </div>

      {isOpen
        ? node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              activeId={activeId}
              collapsed={collapsed}
              drag={drag}
              dropTarget={dropTarget}
              renaming={renaming}
              setRenaming={setRenaming}
              actions={actions}
            />
          ))
        : null}
    </>
  );
}

function NewWorkspaceDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New workspace"
      className="fixed inset-0 z-[70] flex items-start justify-center bg-night-900/75 px-5 pt-[18vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (name.trim().length === 0) return;
          setBusy(true);
          try {
            await onCreate(name.trim());
            onClose();
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-[380px] rounded-xl border border-night-600 bg-night-800 p-5 shadow-2xl shadow-black/60"
      >
        <h2 className="text-[14px] font-medium text-moon">New workspace</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-dusk">
          A shared space you can invite people into. Your personal workspace stays private.
        </p>

        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Design team"
          aria-label="Workspace name"
          autoFocus
          className="mt-4"
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            Create workspace
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Sidebar({
  activeDocumentId,
  onOpenSearch,
  onNavigate,
}: {
  activeDocumentId: string | null;
  onOpenSearch: () => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const user = useSession((state) => state.user);
  const {
    workspaces,
    activeWorkspaceId,
    documents,
    selectWorkspace,
    createDocument,
    renameDocument,
    deleteDocument,
    moveDocument,
    createWorkspace,
  } = useWorkspaces();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const navRef = useRef<HTMLElement>(null);
  const pending = useRef<{ documentId: string; title: string; x: number; y: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);

  const tree = useMemo(() => buildDocumentTree(documents), [documents]);
  const activeWorkspace = workspaces.find(
    (workspace: WorkspaceSummary) => workspace.id === activeWorkspaceId,
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addDocument = useCallback(
    async (parentId: string | null, isFolder: boolean) => {
      if (!activeWorkspaceId) return;

      const document = await createDocument({
        workspaceId: activeWorkspaceId,
        parentId,
        isFolder,
      });

      if (parentId) {
        setCollapsed((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      }

      if (isFolder) setRenaming(document.id);
      else router.push(`/d/${document.id}`);
    },
    [activeWorkspaceId, createDocument, router],
  );

  const removeDocument = useCallback(
    async (node: DocumentTreeNode) => {
      const label = node.isFolder ? 'folder' : 'page';
      const extra = node.children.length > 0 ? ' and everything inside it' : '';

      if (!window.confirm(`Delete the ${label} "${node.title}"${extra}?`)) return;

      await deleteDocument(node.id);
      if (activeDocumentId === node.id) router.push('/');
    },
    [deleteDocument, activeDocumentId, router],
  );

  const clearTimers = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (expandTimer.current !== null) {
      window.clearTimeout(expandTimer.current.timer);
      expandTimer.current = null;
    }
  }, []);

  const probe = useCallback(
    (x: number, y: number, draggedId: string): DropProbe => {
      const nav = navRef.current;
      const element = document.elementFromPoint(x, y);

      if (!nav || !element || !nav.contains(element)) return { kind: 'outside' };

      const row = element.closest<HTMLElement>('[data-doc-id]');
      const documentId = row?.dataset.docId;

      if (!row || !documentId) return { kind: 'empty' };

      const candidate: DropTarget = {
        documentId,
        mode: dropModeFromPointer(row.getBoundingClientRect(), y),
      };

      return canDrop(documents, draggedId, candidate)
        ? { kind: 'row', target: candidate }
        : { kind: 'blocked' };
    },
    [documents],
  );

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      if (!drag) return;
      event.preventDefault();

      setDrag((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : current,
      );

      const result = probe(event.clientX, event.clientY, drag.documentId);
      const target = result.kind === 'row' ? result.target : null;
      setDropTarget(target);

      if (target?.mode === 'inside' && collapsed.has(target.documentId)) {
        if (expandTimer.current?.id !== target.documentId) {
          if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
          const documentId = target.documentId;
          expandTimer.current = {
            id: documentId,
            timer: window.setTimeout(() => {
              setCollapsed((current) => {
                const next = new Set(current);
                next.delete(documentId);
                return next;
              });
            }, HOVER_EXPAND_MS),
          };
        }
      } else if (expandTimer.current) {
        window.clearTimeout(expandTimer.current.timer);
        expandTimer.current = null;
      }
    }

    async function onUp(event: PointerEvent) {
      if (!drag) return;
      clearTimers();

      const result = probe(event.clientX, event.clientY, drag.documentId);

      const placement =
        result.kind === 'row'
          ? resolveDrop(documents, drag.documentId, result.target)
          : result.kind === 'empty'
            ? resolveRootDrop(documents, drag.documentId)
            : null;

      setDrag(null);
      setDropTarget(null);

      if (placement) {
        await moveDocument(drag.documentId, placement.parentId, placement.index);
      }
    }

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, documents, collapsed, probe, moveDocument, clearTimers]);

  const onDragStart = useCallback((event: React.PointerEvent, node: DocumentTreeNode) => {
    event.preventDefault();
    pending.current = {
      documentId: node.id,
      title: node.title,
      x: event.clientX,
      y: event.clientY,
    };

    const begin = () => {
      const start = pending.current;
      if (!start) return;
      setDrag({ ...start });
      pending.current = null;
    };

    if (event.pointerType === 'touch') {
      holdTimer.current = window.setTimeout(begin, TOUCH_HOLD_MS);
      return;
    }

    function onMove(moveEvent: PointerEvent) {
      const start = pending.current;
      if (!start) return;
      const distance = Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y);
      if (distance > DRAG_THRESHOLD) {
        begin();
        window.removeEventListener('pointermove', onMove);
      }
    }

    function onUp() {
      pending.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  useEffect(() => {
    function cancelPending() {
      pending.current = null;
      clearTimers();
    }

    window.addEventListener('pointerup', cancelPending);
    return () => {
      window.removeEventListener('pointerup', cancelPending);
      clearTimers();
    };
  }, [clearTimers]);

  const actions: RowActions = {
    onToggle: toggle,
    onCreateChild: (parentId, isFolder) => void addDocument(parentId, isFolder),
    onRename: (id, title) => void renameDocument(id, title),
    onDelete: (node) => void removeDocument(node),
    onNavigate,
    onDragStart,
  };

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-night-600 bg-night-850">
      <div className="flex h-12 items-center justify-between px-3">
        <Link href="/" className="flex items-center">
          <Wordmark size={17} />
        </Link>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search documents"
          title="Search"
          className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
        >
          <Search size={14} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <select
          value={activeWorkspaceId ?? ''}
          onChange={(event) => void selectWorkspace(event.target.value)}
          aria-label="Active workspace"
          className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-night-600 bg-night-800 px-2 text-[12.5px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setCreatingWorkspace(true)}
          aria-label="New workspace"
          title="New workspace"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-night-600 text-dusk hover:border-night-500 hover:text-moon"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-dusk">
          Pages
        </span>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void addDocument(null, true)}
            aria-label="New folder"
            title="New folder"
            className="flex h-5 w-5 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-moon"
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            onClick={() => void addDocument(null, false)}
            aria-label="New page"
            title="New page"
            className="flex h-5 w-5 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-moon"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <nav ref={navRef} className="flex-1 overflow-y-auto px-2 pb-3">
        {tree.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-dusk">
            No pages yet. Add one to start writing.
          </p>
        ) : (
          tree.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              activeId={activeDocumentId}
              collapsed={collapsed}
              drag={drag}
              dropTarget={dropTarget}
              renaming={renaming}
              setRenaming={setRenaming}
              actions={actions}
            />
          ))
        )}
      </nav>

      {activeWorkspace && activeWorkspace.kind === 'group' ? (
        <Link
          href={`/w/${activeWorkspace.id}/members`}
          className="mx-2 mb-1 flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] text-haze hover:bg-night-750 hover:text-moon"
        >
          <Users size={13} />
          {activeWorkspace.memberCount} member{activeWorkspace.memberCount === 1 ? '' : 's'}
        </Link>
      ) : null}

      <div className="border-t border-night-600 p-2">
        <Link
          href="/settings"
          className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-haze hover:bg-night-750 hover:text-moon"
        >
          {user ? (
            <Avatar
              name={user.displayName}
              color={user.avatarColor}
              url={user.avatarUrl}
              size={20}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{user?.displayName ?? 'Account'}</span>
          <Settings size={13} className="shrink-0 text-dusk" />
        </Link>
      </div>

      {creatingWorkspace ? (
        <NewWorkspaceDialog
          onClose={() => setCreatingWorkspace(false)}
          onCreate={async (name) => {
            await createWorkspace(name);
          }}
        />
      ) : null}

      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] rounded-md border border-lull-400/50 bg-night-800 px-2 py-1 text-[12.5px] text-moon shadow-lg shadow-black/50"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
        >
          {drag.title}
        </div>
      ) : null}
    </aside>
  );
}
