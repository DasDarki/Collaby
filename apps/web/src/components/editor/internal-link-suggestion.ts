'use client';

import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { internalHref } from '@collaby/editor';

export interface DocumentSuggestion {
  id: string;
  title: string;
  icon: string | null;
}

export const internalLinkPluginKey = new PluginKey('collabyInternalLink');

export interface InternalLinkOptions {
  suggestion: Omit<SuggestionOptions<DocumentSuggestion>, 'editor'>;
}

export const InternalLinkSuggestion = Extension.create<InternalLinkOptions>({
  name: 'internalLinkSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '[[',
        startOfLine: false,
        pluginKey: internalLinkPluginKey,
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'text',
                text: props.title,
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: internalHref(props.id),
                      documentId: props.id,
                    },
                  },
                ],
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
