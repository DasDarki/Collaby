import * as Y from 'yjs';
import { Node } from '@tiptap/pm/model';
import { prosemirrorToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import { collabySchema, documentToMarkdown, markdownToDocument } from '@collaby/editor';

export const COLLAB_FRAGMENT = 'default';

export function yDocToMarkdown(ydoc: Y.Doc): string {
  const json = yDocToProsemirrorJSON(ydoc, COLLAB_FRAGMENT);
  const node = Node.fromJSON(collabySchema(), json);
  return documentToMarkdown(node);
}

export function markdownToYDoc(markdown: string): Y.Doc {
  return prosemirrorToYDoc(markdownToDocument(markdown), COLLAB_FRAGMENT);
}

export function encodeState(ydoc: Y.Doc): Buffer {
  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
}

export function applyState(ydoc: Y.Doc, state: Buffer | Uint8Array): void {
  Y.applyUpdate(ydoc, new Uint8Array(state));
}
