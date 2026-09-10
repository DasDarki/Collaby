import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Placeholder, TrailingNode } from '@tiptap/extensions';
import { createLowlight, common } from 'lowlight';
import { Callout } from './extensions/callout.js';
import { TaskListWithMarkers } from './extensions/task-list-input.js';
import { CommentAnchor } from './extensions/comment-anchor.js';
import { DocumentLink } from './extensions/document-link.js';
import { MediaImage } from './extensions/media-image.js';
import { Mermaid } from './extensions/mermaid.js';

export interface BaseExtensionOptions {
  history?: boolean;
  placeholder?: string;
  comments?: boolean;
}

export const lowlight = createLowlight(common);

export function createBaseExtensions(options: BaseExtensionOptions = {}): Extensions {
  const { history = true, placeholder, comments = true } = options;

  const extensions: Extensions = [
    StarterKit.configure({
      undoRedo: history ? undefined : false,
      codeBlock: false,
      link: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      horizontalRule: {},
    }),
    TextStyleKit.configure({
      fontFamily: false,
      lineHeight: false,
    }),
    TaskListWithMarkers,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true, allowTableNodeSelection: true },
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph', 'image'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
    Highlight.configure({ multicolor: true }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
      exitOnTripleEnter: true,
    }),
    Callout,
    Mermaid,
    MediaImage,
    DocumentLink,
    TrailingNode,
  ];

  if (comments) {
    extensions.push(CommentAnchor);
  }

  if (placeholder) {
    extensions.push(Placeholder.configure({ placeholder }));
  }

  return extensions;
}
