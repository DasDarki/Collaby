'use client';

import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { Callout, CALLOUT_KINDS, type CalloutKind } from '@collaby/editor';
import {
  Bug,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Flame,
  HelpCircle,
  Info,
  ListChecks,
  Pencil,
  Quote,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Popover } from '@/components/popover';
import { cn } from '@/lib/cn';

const KIND_STYLE: Record<CalloutKind, { icon: LucideIcon; color: string; label: string }> = {
  note: { icon: Pencil, color: '#7cc7ff', label: 'Note' },
  abstract: { icon: ClipboardList, color: '#4fd1c5', label: 'Abstract' },
  info: { icon: Info, color: '#7cc7ff', label: 'Info' },
  todo: { icon: ListChecks, color: '#7c9cff', label: 'Todo' },
  tip: { icon: Flame, color: '#4fd1c5', label: 'Tip' },
  success: { icon: Check, color: '#6fcf97', label: 'Success' },
  question: { icon: HelpCircle, color: '#f0b76b', label: 'Question' },
  warning: { icon: TriangleAlert, color: '#f0b76b', label: 'Warning' },
  failure: { icon: X, color: '#f2777a', label: 'Failure' },
  danger: { icon: Zap, color: '#f2777a', label: 'Danger' },
  bug: { icon: Bug, color: '#f2777a', label: 'Bug' },
  example: { icon: CircleAlert, color: '#b9a3ff', label: 'Example' },
  quote: { icon: Quote, color: '#9aa3bd', label: 'Quote' },
};

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = (node.attrs.kind ?? 'note') as CalloutKind;
  const title = (node.attrs.title as string | null) ?? '';
  const collapsed = Boolean(node.attrs.collapsed);
  const style = KIND_STYLE[kind] ?? KIND_STYLE.note;
  const Icon = style.icon;
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="blockquote"
      data-callout={kind}
      className="collaby-callout"
      style={
        {
          '--callout-color': style.color,
        } as React.CSSProperties
      }
    >
      <div className="collaby-callout__head" contentEditable={false}>
        <Popover
          align="start"
          className="w-[168px]"
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label={`Callout type: ${style.label}`}
              disabled={!editable}
              onClick={toggle}
              className="collaby-callout__icon"
            >
              <Icon size={15} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="grid gap-0.5">
              {CALLOUT_KINDS.map((candidate) => {
                const option = KIND_STYLE[candidate];
                const OptionIcon = option.icon;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => {
                      updateAttributes({ kind: candidate });
                      close();
                    }}
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] transition-colors',
                      candidate === kind
                        ? 'bg-night-700 text-moon'
                        : 'text-haze hover:bg-night-750 hover:text-moon',
                    )}
                  >
                    <OptionIcon size={13} style={{ color: option.color }} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </Popover>

        {editable ? (
          <input
            value={title}
            placeholder={style.label}
            aria-label="Callout title"
            onChange={(event) =>
              updateAttributes({ title: event.target.value.length > 0 ? event.target.value : null })
            }
            className="collaby-callout__title"
          />
        ) : (
          <span className="collaby-callout__title">{title || style.label}</span>
        )}

        <button
          type="button"
          aria-label={collapsed ? 'Expand callout' : 'Collapse callout'}
          aria-expanded={!collapsed}
          onClick={() => updateAttributes({ collapsed: !collapsed })}
          className={cn('collaby-callout__fold', collapsed && 'is-collapsed')}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <NodeViewContent className={cn('collaby-callout__body', collapsed && 'is-hidden')} />
    </NodeViewWrapper>
  );
}

export const CalloutBlock = Callout.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
