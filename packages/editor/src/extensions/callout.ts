import { Node, mergeAttributes } from '@tiptap/core';

export const CALLOUT_KINDS = [
  'note',
  'abstract',
  'info',
  'todo',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const KIND_ALIASES: Record<string, CalloutKind> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

export function normalizeCalloutKind(value: string | null | undefined): CalloutKind {
  if (!value) return 'note';
  return KIND_ALIASES[value.trim().toLowerCase()] ?? 'note';
}

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attributes?: { kind?: CalloutKind; title?: string | null }) => ReturnType;
      toggleCallout: (attributes?: { kind?: CalloutKind; title?: string | null }) => ReturnType;
      unsetCallout: () => ReturnType;
      updateCalloutAttributes: (attributes: {
        kind?: CalloutKind;
        title?: string | null;
        collapsed?: boolean;
      }) => ReturnType;
    };
  }
}

export const CALLOUT_MARKER_REGEX = /^\s*(?:>\s*)?\[!([A-Za-z]+)\]([+-])?[ \t]*(.*)$/;

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',
  priority: 200,
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'note' as CalloutKind,
        parseHTML: (element) => normalizeCalloutKind(element.getAttribute('data-callout')),
        renderHTML: (attributes) => ({ 'data-callout': attributes.kind ?? 'note' }),
      },
      title: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-callout-title'),
        renderHTML: (attributes) =>
          attributes.title ? { 'data-callout-title': String(attributes.title) } : {},
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-callout-collapsed') === 'true',
        renderHTML: (attributes) =>
          attributes.collapsed ? { 'data-callout-collapsed': 'true' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote[data-callout]' }, { tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'blockquote',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'collaby-callout' }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, {
            kind: normalizeCalloutKind(attributes?.kind),
            title: attributes?.title ?? null,
          }),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, {
            kind: normalizeCalloutKind(attributes?.kind),
            title: attributes?.title ?? null,
          }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
      updateCalloutAttributes:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout({ kind: 'note' }),

      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if (!empty || $from.parent.type.name !== 'paragraph') return false;

        const match = CALLOUT_MARKER_REGEX.exec($from.parent.textContent);
        if (!match) return false;

        const attributes = {
          kind: normalizeCalloutKind(match[1]),
          collapsed: match[2] === '-',
          title: match[3]?.trim() || null,
        };

        let blockquoteDepth = -1;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'blockquote') {
            blockquoteDepth = depth;
            break;
          }
        }

        const lineStart = $from.start();
        const lineEnd = $from.end();
        const blockquotePos = blockquoteDepth >= 0 ? $from.before(blockquoteDepth) : -1;

        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.delete(lineStart, lineEnd);
            if (blockquotePos >= 0) tr.setNodeMarkup(blockquotePos, this.type, attributes);
            return true;
          })
          .command(({ commands }) =>
            blockquotePos >= 0 ? true : commands.wrapIn(this.name, attributes),
          )
          .run();
      },
    };
  },
});
