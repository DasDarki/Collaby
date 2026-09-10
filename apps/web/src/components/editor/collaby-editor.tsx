'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { createBaseExtensions, isExternalHref, parseInternalHref } from '@collaby/editor';
import type { PresenceUser } from '@collaby/shared';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { api } from '@/lib/api';
import { EditorToolbar } from './toolbar';
import { CalloutBlock } from './callout-node';
import { MermaidBlock } from './mermaid-node';
import { ResizableImage } from './image-node';
import { InternalLinkSuggestion, type DocumentSuggestion } from './internal-link-suggestion';
import { createSuggestionRenderer } from './suggestion-renderer';
import { PresenceRail, type RailMark } from './presence';
import { ExternalLinkPrompt } from './external-link-prompt';
import { renderCollaborationCaret } from './caret-render';
import { awarenessPayload, type CollabIdentity } from './use-collab-document';

export interface CollabyEditorProps {
  documentId: string;
  workspaceId: string;
  provider: HocuspocusProvider;
  editable: boolean;
  canComment: boolean;
  identity: CollabIdentity;
  peers: PresenceUser[];
  onEditorReady: (editor: Editor) => void;
  onCommentRequest: (anchorId: string, quotedText: string) => void;
  onCommentSelect: (anchorId: string) => void;
  onNavigate: (documentId: string) => void;
  onHeadingTitle: (title: string) => void;
}

export function CollabyEditor({
  documentId,
  workspaceId,
  provider,
  editable,
  canComment,
  identity,
  peers,
  onEditorReady,
  onCommentRequest,
  onCommentSelect,
  onNavigate,
  onHeadingTitle,
}: CollabyEditorProps) {
  const [externalHref, setExternalHref] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headingTimer = useRef<number | null>(null);
  const lastHeading = useRef<string | null>(null);
  const onHeadingTitleRef = useRef(onHeadingTitle);

  onHeadingTitleRef.current = onHeadingTitle;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [railMarks, setRailMarks] = useState<RailMark[]>([]);

  const searchDocuments = useCallback(
    async (query: string): Promise<DocumentSuggestion[]> => {
      try {
        return await api.get<DocumentSuggestion[]>('/api/documents/search', {
          query: { q: query, workspaceId },
        });
      } catch {
        return [];
      }
    },
    [workspaceId],
  );

  const extensions = useMemo(() => {
    const base = createBaseExtensions({
      history: false,
      placeholder: 'Start writing, or press / for blocks',
    }).filter(
      (extension) =>
        extension.name !== 'mermaid' && extension.name !== 'image' && extension.name !== 'callout',
    );

    return [
      ...base,
      CalloutBlock,
      MermaidBlock,
      ResizableImage,
      Collaboration.configure({ document: provider.document }),
      CollaborationCaret.configure({
        provider,
        user: awarenessPayload(identity),
        render: renderCollaborationCaret,
      }),
      InternalLinkSuggestion.configure({
        suggestion: {
          items: ({ query }: { query: string }) => searchDocuments(query),
          render: createSuggestionRenderer,
        },
      }),
    ];
  }, [provider, identity, searchDocuments]);

  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: false,
      onUpdate({ editor: instance }) {
        if (!instance.isEditable || !instance.isFocused) return;

        const first = instance.state.doc.firstChild;
        if (!first || first.type.name !== 'heading' || first.attrs.level !== 1) return;

        const heading = first.textContent.trim().slice(0, 200);
        if (heading.length === 0 || heading === lastHeading.current) return;

        if (headingTimer.current !== null) window.clearTimeout(headingTimer.current);
        headingTimer.current = window.setTimeout(() => {
          lastHeading.current = heading;
          onHeadingTitleRef.current(heading);
        }, 700);
      },
      editorProps: {
        attributes: {
          class: 'collaby-prose',
          spellcheck: 'true',
        },
        handleClickOn(_view, _pos, _node, _nodePos, event) {
          const target = (event.target as HTMLElement).closest('a');
          if (!target) return false;

          const href = target.getAttribute('href');
          const internalId = parseInternalHref(href) ?? target.getAttribute('data-document-id');

          if (internalId) {
            event.preventDefault();
            onNavigate(internalId);
            return true;
          }

          if (isExternalHref(href)) {
            event.preventDefault();
            setExternalHref(href);
            return true;
          }

          return false;
        },
      },
    },
    [extensions, editable],
  );

  useEffect(() => {
    if (editor) onEditorReady(editor);
  }, [editor, onEditorReady]);

  useEffect(
    () => () => {
      if (headingTimer.current !== null) window.clearTimeout(headingTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    function onClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement).closest('[data-comment-anchor]');
      if (anchor) {
        onCommentSelect(anchor.getAttribute('data-comment-anchor') ?? '');
      }
    }

    surface.addEventListener('click', onClick);
    return () => surface.removeEventListener('click', onClick);
  }, [onCommentSelect]);

  useEffect(() => {
    if (!editor) return;

    function readRail(): RailMark[] {
      const surface = surfaceRef.current;
      if (!surface) return [];

      const height = surface.offsetHeight || 1;
      const carets = surface.querySelectorAll<HTMLElement>(
        '.collaboration-carets__caret[data-user-id]',
      );

      const marks: RailMark[] = [];
      const seen = new Set<string>();

      for (const caret of carets) {
        const userId = caret.dataset.userId;
        if (!userId || seen.has(userId)) continue;

        const peer = peers.find((candidate) => candidate.userId === userId);
        if (!peer) continue;

        seen.add(userId);
        marks.push({
          clientId: peer.clientId,
          displayName: peer.displayName,
          color: peer.avatarColor,
          offset: (caret.offsetTop + caret.offsetHeight / 2) / height,
        });
      }

      return marks;
    }

    function sync() {
      const next = readRail();
      setRailMarks((current) => {
        const changed =
          current.length !== next.length ||
          next.some(
            (mark, index) =>
              current[index]?.clientId !== mark.clientId ||
              Math.abs((current[index]?.offset ?? 0) - mark.offset) > 0.004,
          );
        return changed ? next : current;
      });
    }

    const interval = window.setInterval(sync, 500);
    return () => window.clearInterval(interval);
  }, [editor, peers]);

  const requestComment = useCallback(() => {
    if (!editor) return;

    const { from, to, empty } = editor.state.selection;
    if (empty) return;

    const anchorId = crypto.randomUUID();
    const quotedText = editor.state.doc.textBetween(from, to, ' ').slice(0, 240);

    editor.chain().focus().setCommentAnchor(anchorId).run();
    onCommentRequest(anchorId, quotedText);
  }, [editor, onCommentRequest]);

  const insertImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!editor) return;

      setUploadError(null);
      try {
        const asset = await api.upload<{ url: string }>(
          `/api/documents/${documentId}/assets`,
          file,
        );
        editor.chain().focus().setImage({ src: asset.url, alt: file.name }).run();
      } catch (cause) {
        setUploadError(
          cause instanceof Error ? cause.message : 'That image could not be uploaded.',
        );
      }
    },
    [editor, documentId],
  );

  if (!editor) {
    return <div className="h-24" />;
  }

  return (
    <>
      <EditorToolbar
        editor={editor}
        canComment={canComment}
        onAddComment={requestComment}
        onInsertImage={insertImage}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadImage(file);
        }}
      />

      {uploadError ? (
        <div className="mx-auto w-full max-w-[820px] px-5 pt-3 md:px-10">
          <p className="rounded-md border border-alarm/35 bg-alarm/10 px-3 py-2 text-[12.5px] text-alarm">
            {uploadError}
          </p>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[820px] px-5 md:px-10">
        <div ref={surfaceRef} className="relative pr-0 lg:pr-6">
          <EditorContent editor={editor} />
          <PresenceRail marks={railMarks} />
        </div>
      </div>

      <ExternalLinkPrompt
        href={externalHref}
        onDismiss={() => setExternalHref(null)}
        onConfirm={() => {
          if (externalHref) window.open(externalHref, '_blank', 'noopener,noreferrer');
          setExternalHref(null);
        }}
      />
    </>
  );
}
