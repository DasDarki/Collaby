'use client';

import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { DocumentSuggestion } from './internal-link-suggestion';

interface RendererState {
  element: HTMLDivElement;
  items: DocumentSuggestion[];
  selectedIndex: number;
  command: SuggestionProps<DocumentSuggestion>['command'];
}

function paint(state: RendererState): void {
  state.element.replaceChildren();

  if (state.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'px-3 py-2 text-[12.5px] text-[#6c7590]';
    empty.textContent = 'No matching pages';
    state.element.append(empty);
    return;
  }

  state.items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
      index === state.selectedIndex
        ? 'bg-[#232734] text-[#e6e9f2]'
        : 'text-[#9aa3bd] hover:bg-[#1f2330]',
    ].join(' ');

    const icon = document.createElement('span');
    icon.className = 'text-[13px]';
    icon.textContent = item.icon ?? '·';

    const label = document.createElement('span');
    label.className = 'truncate';
    label.textContent = item.title;

    button.append(icon, label);
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      state.command(item);
    });

    state.element.append(button);
  });
}

function position(element: HTMLElement, rect: DOMRect | null): void {
  if (!rect) return;
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.bottom + 6}px`;
}

export function createSuggestionRenderer() {
  let state: RendererState | null = null;

  return {
    onStart(props: SuggestionProps<DocumentSuggestion>) {
      const element = document.createElement('div');
      element.className =
        'fixed z-50 max-h-[240px] w-[248px] overflow-y-auto rounded-lg border border-[#2f3442] bg-[#1a1d28] p-1 shadow-xl shadow-black/50';
      document.body.append(element);

      state = { element, items: props.items, selectedIndex: 0, command: props.command };
      paint(state);
      position(element, props.clientRect?.() ?? null);
    },

    onUpdate(props: SuggestionProps<DocumentSuggestion>) {
      if (!state) return;
      state.items = props.items;
      state.command = props.command;
      state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, props.items.length - 1));
      paint(state);
      position(state.element, props.clientRect?.() ?? null);
    },

    onKeyDown(props: SuggestionKeyDownProps) {
      if (!state) return false;

      if (props.event.key === 'ArrowDown') {
        state.selectedIndex = (state.selectedIndex + 1) % Math.max(1, state.items.length);
        paint(state);
        return true;
      }

      if (props.event.key === 'ArrowUp') {
        state.selectedIndex =
          (state.selectedIndex - 1 + state.items.length) % Math.max(1, state.items.length);
        paint(state);
        return true;
      }

      if (props.event.key === 'Enter') {
        const item = state.items[state.selectedIndex];
        if (item) {
          state.command(item);
          return true;
        }
      }

      if (props.event.key === 'Escape') {
        state.element.remove();
        state = null;
        return true;
      }

      return false;
    },

    onExit() {
      state?.element.remove();
      state = null;
    },
  };
}
