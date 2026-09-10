import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentAnchorOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentAnchor: {
      setCommentAnchor: (anchorId: string) => ReturnType;
      unsetCommentAnchor: (anchorId?: string) => ReturnType;
    };
  }
}

export const CommentAnchor = Mark.create<CommentAnchorOptions>({
  name: 'commentAnchor',
  excludes: '',
  inclusive: false,
  keepOnSplit: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-anchor'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-comment-anchor': attributes.anchorId } : {},
      },
      resolved: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-comment-resolved') === 'true',
        renderHTML: (attributes) =>
          attributes.resolved ? { 'data-comment-resolved': 'true' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-anchor]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'collaby-comment' }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentAnchor:
        (anchorId) =>
        ({ commands }) =>
          commands.setMark(this.name, { anchorId }),
      unsetCommentAnchor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
