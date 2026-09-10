'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronRight, ListTree, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface HeadingEntry {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface HeadingNode extends HeadingEntry {
  children: HeadingNode[];
}

export function useHeadings(editor: Editor | null): HeadingEntry[] {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);

  useEffect(() => {
    if (!editor) {
      setHeadings([]);
      return;
    }

    function read() {
      if (!editor) return;

      const found: HeadingEntry[] = [];
      let index = 0;

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;

        const text = node.textContent.trim();
        found.push({
          id: `${index}-${pos}`,
          level: Number(node.attrs.level ?? 1),
          text: text.length > 0 ? text : 'Untitled section',
          pos,
        });
        index += 1;
      });

      setHeadings((current) => {
        const same =
          current.length === found.length &&
          current.every(
            (entry, i) =>
              entry.text === found[i]?.text &&
              entry.level === found[i]?.level &&
              entry.pos === found[i]?.pos,
          );
        return same ? current : found;
      });
    }

    read();
    editor.on('update', read);
    editor.on('create', read);

    return () => {
      editor.off('update', read);
      editor.off('create', read);
    };
  }, [editor]);

  return headings;
}

function buildHeadingTree(entries: HeadingEntry[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const entry of entries) {
    const node: HeadingNode = { ...entry, children: [] };

    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);

    stack.push(node);
  }

  return roots;
}

function HeadingRow({
  node,
  depth,
  activeId,
  collapsed,
  onToggle,
  onJump,
}: {
  node: HeadingNode;
  depth: number;
  activeId: string | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onJump: (node: HeadingNode) => void;
}) {
  const isOpen = !collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 transition-colors',
          node.id === activeId
            ? 'bg-night-700 text-moon'
            : 'text-haze hover:bg-night-750 hover:text-moon',
        )}
        style={{ paddingLeft: 2 + depth * 11 }}
      >
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${node.text}` : `Expand ${node.text}`}
          onClick={() => onToggle(node.id)}
          className={cn(
            'flex h-5 w-4 shrink-0 items-center justify-center rounded text-dusk transition-transform',
            hasChildren ? 'hover:text-moon' : 'invisible',
            isOpen && 'rotate-90',
          )}
        >
          <ChevronRight size={11} />
        </button>

        <button
          type="button"
          onClick={() => onJump(node)}
          title={node.text}
          className={cn(
            'min-w-0 flex-1 truncate py-1 text-left',
            node.level === 1 ? 'text-[13px] font-medium' : 'text-[12.5px]',
          )}
        >
          {node.text}
        </button>
      </div>

      {isOpen
        ? node.children.map((child) => (
            <HeadingRow
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              collapsed={collapsed}
              onToggle={onToggle}
              onJump={onJump}
            />
          ))
        : null}
    </>
  );
}

export function TocPanel({
  editor,
  scrollRef,
  onClose,
}: {
  editor: Editor | null;
  scrollRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const headings = useHeadings(editor);
  const tree = useMemo(() => buildHeadingTree(headings), [headings]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const jump = useCallback(
    (node: HeadingNode) => {
      if (!editor) return;

      const dom = editor.view.nodeDOM(node.pos);
      const element = dom instanceof HTMLElement ? dom : null;

      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(node.id);
    },
    [editor],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !editor || headings.length === 0) return;

    let frame = 0;

    function sync() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editor) return;

        const top = container!.getBoundingClientRect().top + 96;
        let current: string | null = headings[0]?.id ?? null;

        for (const heading of headings) {
          const dom = editor.view.nodeDOM(heading.pos);
          if (!(dom instanceof HTMLElement)) continue;
          if (dom.getBoundingClientRect().top <= top) current = heading.id;
          else break;
        }

        setActiveId(current);
      });
    }

    sync();
    container.addEventListener('scroll', sync, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', sync);
    };
  }, [scrollRef, editor, headings]);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-night-600 bg-night-850 lg:w-[280px]">
      <div className="flex h-12 items-center justify-between border-b border-night-600 px-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-moon">
          <ListTree size={13} className="text-dusk" />
          Contents
          {headings.length > 0 ? (
            <span className="font-mono text-[11px] text-dusk">{headings.length}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close contents"
          className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-dusk">
            Headings you add show up here, so you can jump straight to a section.
          </p>
        ) : (
          tree.map((node) => (
            <HeadingRow
              key={node.id}
              node={node}
              depth={0}
              activeId={activeId}
              collapsed={collapsed}
              onToggle={toggle}
              onJump={jump}
            />
          ))
        )}
      </div>
    </aside>
  );
}
