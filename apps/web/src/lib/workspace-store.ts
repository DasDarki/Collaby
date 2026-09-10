'use client';

import { create } from 'zustand';
import type { DocumentNode, WorkspaceSummary } from '@collaby/shared';
import { api } from './api';

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  documents: DocumentNode[];
  loading: boolean;
  loadWorkspaces: () => Promise<WorkspaceSummary[]>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  loadDocuments: (workspaceId: string) => Promise<void>;
  createDocument: (input: {
    workspaceId: string;
    parentId?: string | null;
    title?: string;
  }) => Promise<DocumentNode>;
  renameDocument: (documentId: string, title: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  moveDocument: (documentId: string, parentId: string | null, index?: number) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceSummary[]>;
}

export const useWorkspaces = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  documents: [],
  loading: false,

  async loadWorkspaces() {
    const workspaces = await api.get<WorkspaceSummary[]>('/api/workspaces');
    set({ workspaces });
    return workspaces;
  },

  async selectWorkspace(workspaceId) {
    set({ activeWorkspaceId: workspaceId });
    await get().loadDocuments(workspaceId);
  },

  async loadDocuments(workspaceId) {
    set({ loading: true });
    try {
      const documents = await api.get<DocumentNode[]>(`/api/workspaces/${workspaceId}/documents`);
      set({ documents, activeWorkspaceId: workspaceId });
    } finally {
      set({ loading: false });
    }
  },

  async createDocument(input) {
    const document = await api.post<DocumentNode>('/api/documents', {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      title: input.title ?? 'Untitled',
    });
    set({ documents: [...get().documents, document] });
    return document;
  },

  async renameDocument(documentId, title) {
    await api.patch(`/api/documents/${documentId}`, { title });
    set({
      documents: get().documents.map((document) =>
        document.id === documentId ? { ...document, title } : document,
      ),
    });
  },

  async deleteDocument(documentId) {
    await api.delete(`/api/documents/${documentId}`);
    set({ documents: get().documents.filter((document) => document.id !== documentId) });
  },

  async moveDocument(documentId, parentId, index) {
    await api.post(`/api/documents/${documentId}/move`, { parentId, index });

    const workspaceId = get().activeWorkspaceId;
    if (workspaceId) await get().loadDocuments(workspaceId);
  },

  async createWorkspace(name) {
    await api.post('/api/workspaces', { name, kind: 'group' });
    return get().loadWorkspaces();
  },
}));

export interface DocumentTreeNode extends DocumentNode {
  children: DocumentTreeNode[];
  depth: number;
}

export function buildDocumentTree(documents: DocumentNode[]): DocumentTreeNode[] {
  const nodes = new Map<string, DocumentTreeNode>();

  for (const document of documents) {
    nodes.set(document.id, { ...document, children: [], depth: 0 });
  }

  const roots: DocumentTreeNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (list: DocumentTreeNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      node.children.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      assignDepth(node.children, depth + 1);
    }
  };

  roots.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  assignDepth(roots, 0);

  return roots;
}
