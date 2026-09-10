import type { DocumentNode } from '@collaby/shared';

export type DropMode = 'before' | 'after' | 'inside';

export interface DropTarget {
  documentId: string;
  mode: DropMode;
}

export interface DropPlacement {
  parentId: string | null;
  index: number;
}

export function siblingsOf(documents: DocumentNode[], parentId: string | null): DocumentNode[] {
  return documents
    .filter((document) => (document.parentId ?? null) === parentId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

export function isAncestor(
  documents: DocumentNode[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const byId = new Map(documents.map((document) => [document.id, document]));
  let current = byId.get(candidateId)?.parentId ?? null;

  while (current) {
    if (current === ancestorId) return true;
    current = byId.get(current)?.parentId ?? null;
  }

  return false;
}

export function canDrop(documents: DocumentNode[], draggedId: string, target: DropTarget): boolean {
  if (draggedId === target.documentId) return false;
  return !isAncestor(documents, draggedId, target.documentId);
}

export function resolveDrop(
  documents: DocumentNode[],
  draggedId: string,
  target: DropTarget,
): DropPlacement | null {
  if (!canDrop(documents, draggedId, target)) return null;

  const targetNode = documents.find((document) => document.id === target.documentId);
  if (!targetNode) return null;

  if (target.mode === 'inside') {
    const children = siblingsOf(documents, targetNode.id).filter((child) => child.id !== draggedId);
    return { parentId: targetNode.id, index: children.length };
  }

  const parentId = targetNode.parentId ?? null;
  const list = siblingsOf(documents, parentId).filter((sibling) => sibling.id !== draggedId);
  const targetIndex = list.findIndex((sibling) => sibling.id === target.documentId);

  if (targetIndex === -1) return null;

  return { parentId, index: target.mode === 'before' ? targetIndex : targetIndex + 1 };
}

export function resolveRootDrop(documents: DocumentNode[], draggedId: string): DropPlacement {
  const roots = siblingsOf(documents, null).filter((document) => document.id !== draggedId);
  return { parentId: null, index: roots.length };
}

export function dropModeFromPointer(rect: DOMRect, clientY: number): DropMode {
  const offset = (clientY - rect.top) / Math.max(1, rect.height);
  if (offset < 0.28) return 'before';
  if (offset > 0.72) return 'after';
  return 'inside';
}
