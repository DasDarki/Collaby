'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MessageSquarePlus,
  Palette,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  TriangleAlert,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Workflow,
} from 'lucide-react';
import { Popover } from '@/components/popover';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

const TEXT_COLORS = [
  { label: 'Default', value: null },
  { label: 'Lavender', value: '#b9a3ff' },
  { label: 'Lamp', value: '#f0b76b' },
  { label: 'Leaf', value: '#6fcf97' },
  { label: 'Alarm', value: '#f2777a' },
  { label: 'Sky', value: '#7cc7ff' },
  { label: 'Haze', value: '#9aa3bd' },
];

const HIGHLIGHT_COLORS = [
  { label: 'None', value: null },
  { label: 'Lavender', value: '#3a2f66' },
  { label: 'Amber', value: '#5c4322' },
  { label: 'Moss', value: '#25452f' },
  { label: 'Rose', value: '#5a2a2c' },
  { label: 'Steel', value: '#2b3446' },
];

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-night-600" aria-hidden />;
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? 'bg-night-700 text-lull-300' : 'text-haze hover:bg-night-750 hover:text-moon',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-haze',
      )}
    >
      {children}
    </button>
  );
}

const ALIGNMENTS = [
  { value: 'left', label: 'Align left', icon: AlignLeft },
  { value: 'center', label: 'Align center', icon: AlignCenter },
  { value: 'right', label: 'Align right', icon: AlignRight },
  { value: 'justify', label: 'Justify', icon: AlignJustify },
] as const;

function AlignmentControl({ editor }: { editor: Editor }) {
  const current =
    ALIGNMENTS.find((option) => editor.isActive({ textAlign: option.value })) ?? ALIGNMENTS[0];
  const CurrentIcon = current.icon;

  return (
    <Popover
      align="start"
      className="w-[152px]"
      trigger={({ toggle }) => (
        <ToolButton
          label={`Text alignment: ${current.label}`}
          active={current.value !== 'left'}
          onClick={toggle}
        >
          <CurrentIcon size={15} />
        </ToolButton>
      )}
    >
      {({ close }) => (
        <div className="grid gap-0.5">
          {ALIGNMENTS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  editor.chain().focus().setTextAlign(option.value).run();
                  close();
                }}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] transition-colors',
                  option.value === current.value
                    ? 'bg-night-700 text-moon'
                    : 'text-haze hover:bg-night-750 hover:text-moon',
                )}
              >
                <OptionIcon size={13} />
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

const BLOCK_STYLES = [
  { label: 'Text', level: null },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 },
  { label: 'Heading 5', level: 5 },
  { label: 'Heading 6', level: 6 },
] as const;

function BlockStyleControl({ editor }: { editor: Editor }) {
  const current =
    BLOCK_STYLES.find(
      (option) => option.level && editor.isActive('heading', { level: option.level }),
    ) ?? BLOCK_STYLES[0];

  return (
    <Popover
      align="start"
      className="w-[164px]"
      trigger={({ toggle }) => (
        <button
          type="button"
          title="Text style"
          aria-label={`Text style: ${current.label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggle}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] transition-colors',
            current.level
              ? 'bg-night-700 text-lull-300'
              : 'text-haze hover:bg-night-750 hover:text-moon',
          )}
        >
          <Type size={14} />
          <span className="hidden sm:inline">{current.label}</span>
          <ChevronDown size={12} className="text-dusk" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="grid gap-0.5">
          {BLOCK_STYLES.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                const chain = editor.chain().focus();
                if (option.level) chain.setHeading({ level: option.level }).run();
                else chain.setParagraph().run();
                close();
              }}
              className={cn(
                'rounded px-2 py-1 text-left text-[12.5px] transition-colors',
                option.label === current.label
                  ? 'bg-night-700 text-moon'
                  : 'text-haze hover:bg-night-750 hover:text-moon',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function InsertControl({ editor, onInsertImage }: { editor: Editor; onInsertImage: () => void }) {
  const items = [
    { label: 'Image', icon: ImageIcon, run: onInsertImage },
    {
      label: 'Table',
      icon: TableIcon,
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { label: 'Quote', icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    {
      label: 'Callout',
      icon: TriangleAlert,
      run: () => editor.chain().focus().toggleCallout({ kind: 'note' }).run(),
    },
    {
      label: 'Code block',
      icon: Code2,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Mermaid diagram',
      icon: Workflow,
      run: () => editor.chain().focus().setMermaidBlock('graph TD\n  A[Start] --> B[Done]').run(),
    },
    {
      label: 'Divider',
      icon: Minus,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];

  return (
    <Popover
      align="start"
      className="w-[186px]"
      trigger={({ toggle }) => (
        <ToolButton label="Insert" onClick={toggle}>
          <Plus size={15} />
        </ToolButton>
      )}
    >
      {({ close }) => (
        <div className="grid gap-0.5">
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.run();
                  close();
                }}
                className="flex items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-haze transition-colors hover:bg-night-750 hover:text-moon"
              >
                <ItemIcon size={13} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function LinkControl({ editor }: { editor: Editor }) {
  const [href, setHref] = useState('');

  return (
    <Popover
      align="start"
      className="w-[280px]"
      trigger={({ toggle }) => (
        <ToolButton
          label="Link"
          active={editor.isActive('link')}
          onClick={() => {
            setHref((editor.getAttributes('link').href as string) ?? '');
            toggle();
          }}
        >
          <Link2 size={15} />
        </ToolButton>
      )}
    >
      {({ close }) => (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (href.trim().length === 0) {
              editor.chain().focus().unsetLink().run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
            }
            close();
          }}
        >
          <Input
            value={href}
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://example.com"
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button type="submit" variant="primary" size="sm" className="flex-1">
              Apply
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                close();
              }}
            >
              Remove
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}

function ColorControl({ editor, kind }: { editor: Editor; kind: 'text' | 'highlight' }) {
  const swatches = kind === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS;
  const active =
    kind === 'text'
      ? (editor.getAttributes('textStyle').color as string | undefined)
      : (editor.getAttributes('highlight').color as string | undefined);

  return (
    <Popover
      align="start"
      className="w-[186px]"
      trigger={({ toggle }) => (
        <ToolButton
          label={kind === 'text' ? 'Text color' : 'Highlight'}
          active={Boolean(active)}
          onClick={toggle}
        >
          {kind === 'text' ? <Palette size={15} /> : <Highlighter size={15} />}
        </ToolButton>
      )}
    >
      {({ close }) => (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1.5">
            {swatches.map((swatch) => (
              <button
                key={swatch.label}
                type="button"
                title={swatch.label}
                aria-label={swatch.label}
                onClick={() => {
                  const chain = editor.chain().focus();
                  if (kind === 'text') {
                    if (swatch.value) chain.setColor(swatch.value).run();
                    else chain.unsetColor().run();
                  } else if (swatch.value) {
                    chain.setHighlight({ color: swatch.value }).run();
                  } else {
                    chain.unsetHighlight().run();
                  }
                  close();
                }}
                className={cn(
                  'h-7 rounded border transition-transform hover:scale-105',
                  active === swatch.value ? 'border-lull-400' : 'border-night-600',
                )}
                style={{
                  backgroundColor: swatch.value ?? 'transparent',
                  color: kind === 'text' ? (swatch.value ?? '#9aa3bd') : undefined,
                }}
              >
                {swatch.value === null ? <span className="text-[11px]">none</span> : null}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[11.5px] text-dusk">
            Custom
            <input
              type="color"
              onChange={(event) => {
                const value = event.target.value;
                if (kind === 'text') editor.chain().focus().setColor(value).run();
                else editor.chain().focus().setHighlight({ color: value }).run();
              }}
              className="h-6 w-10 cursor-pointer rounded border border-night-600 bg-transparent"
            />
          </label>
        </div>
      )}
    </Popover>
  );
}

export function EditorToolbar({
  editor,
  canComment,
  onAddComment,
  onInsertImage,
}: {
  editor: Editor;
  canComment: boolean;
  onAddComment: () => void;
  onInsertImage: () => void;
}) {
  const editable = editor.isEditable;

  return (
    <div className="sticky top-0 z-30 flex items-center gap-0.5 overflow-x-auto border-b border-night-600 bg-night-900/90 px-4 py-1.5 backdrop-blur-sm md:px-9 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToolButton
        label="Undo"
        disabled={!editable || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!editable || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </ToolButton>

      <Divider />

      {editable ? <BlockStyleControl editor={editor} /> : null}

      <Divider />

      <ToolButton
        label="Bold"
        active={editor.isActive('bold')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={editor.isActive('italic')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={editor.isActive('underline')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={15} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={15} />
      </ToolButton>
      <ToolButton
        label="Inline code"
        active={editor.isActive('code')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={15} />
      </ToolButton>

      {editable ? <ColorControl editor={editor} kind="text" /> : null}
      {editable ? <ColorControl editor={editor} kind="highlight" /> : null}

      <Divider />

      <ToolButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolButton>
      <ToolButton
        label="Task list"
        active={editor.isActive('taskList')}
        disabled={!editable}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo size={15} />
      </ToolButton>

      {editable ? <AlignmentControl editor={editor} /> : null}

      <Divider />

      {editable ? <LinkControl editor={editor} /> : null}
      {editable ? <InsertControl editor={editor} onInsertImage={onInsertImage} /> : null}

      {canComment ? (
        <>
          <Divider />
          <ToolButton
            label="Comment on selection"
            disabled={editor.state.selection.empty}
            onClick={onAddComment}
          >
            <MessageSquarePlus size={15} />
          </ToolButton>
        </>
      ) : null}
    </div>
  );
}
