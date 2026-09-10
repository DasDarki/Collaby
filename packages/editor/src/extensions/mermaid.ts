import { textblockTypeInputRule } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      setMermaidBlock: (source?: string) => ReturnType;
      toggleMermaidBlock: () => ReturnType;
    };
  }
}

export const MERMAID_INPUT_REGEX = /^```mermaid[\s\n]$/;

export const Mermaid = CodeBlock.extend({
  name: 'mermaid',
  priority: 200,

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [
      { tag: 'pre[data-type="mermaid"]', preserveWhitespace: 'full' },
      { tag: 'div[data-type="mermaid"]', preserveWhitespace: 'full' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      { ...this.options.HTMLAttributes, ...HTMLAttributes, 'data-type': 'mermaid' },
      ['code', {}, 0],
    ];
  },

  addCommands() {
    return {
      setMermaidBlock:
        (source) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: source ? [{ type: 'text', text: source }] : undefined,
          }),
      toggleMermaidBlock:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, 'paragraph'),
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Mod-Alt-m': () => this.editor.commands.setMermaidBlock('graph TD\n  A[Start] --> B[End]'),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: MERMAID_INPUT_REGEX,
        type: this.type,
      }),
    ];
  },
}).configure({
  exitOnTripleEnter: true,
  exitOnArrowDown: true,
});
