'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { Mermaid } from '@collaby/editor';
import { Code2, Eye } from 'lucide-react';
import { cn } from '@/lib/cn';

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

async function loadMermaid() {
  mermaidReady ??= import('mermaid').then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'var(--font-sans)',
      themeVariables: {
        background: '#1a1d28',
        primaryColor: '#232734',
        primaryTextColor: '#e6e9f2',
        primaryBorderColor: '#3d4354',
        lineColor: '#6c7590',
        secondaryColor: '#1f2330',
        tertiaryColor: '#171a24',
        noteBkgColor: '#232734',
        noteTextColor: '#e6e9f2',
        noteBorderColor: '#3d4354',
      },
    });
    return module.default;
  });

  return mermaidReady;
}

function MermaidView(props: NodeViewProps) {
  const { node, editor } = props;
  const source = node.textContent;
  const domId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const latest = useRef(source);

  latest.current = source;

  useEffect(() => {
    let cancelled = false;

    if (source.trim().length === 0) {
      setSvg(null);
      setError(null);
      return;
    }

    void loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${domId}`, source))
      .then(({ svg: rendered }) => {
        if (!cancelled && latest.current === source) {
          setSvg(rendered);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSvg(null);
        setError(cause instanceof Error ? cause.message : 'This diagram could not be drawn.');
      });

    return () => {
      cancelled = true;
    };
  }, [source, domId]);

  const editing = showSource || svg === null;

  return (
    <NodeViewWrapper
      className="group relative my-5 overflow-hidden rounded-lg border border-night-600 bg-night-850"
      data-type="mermaid"
    >
      <div className="flex items-center justify-between border-b border-night-600 px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-dusk">
          mermaid
        </span>
        <button
          type="button"
          onClick={() => setShowSource((value) => !value)}
          contentEditable={false}
          disabled={svg === null}
          className="flex h-6 items-center gap-1.5 rounded px-1.5 text-[11.5px] text-dusk transition-colors hover:bg-night-700 hover:text-moon disabled:opacity-40"
        >
          {editing ? <Eye size={12} /> : <Code2 size={12} />}
          {editing ? 'Preview' : 'Edit'}
        </button>
      </div>

      <pre
        className={cn(
          'm-0 overflow-x-auto whitespace-pre px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-haze',
          editing ? 'block' : 'hidden',
        )}
      >
        <NodeViewContent />
      </pre>

      {!editing && svg ? (
        <div
          contentEditable={false}
          className="flex justify-center overflow-x-auto px-4 py-5 [&_svg]:h-auto [&_svg]:max-w-full"
          onDoubleClick={() => editor.isEditable && setShowSource(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}

      {error ? (
        <p
          contentEditable={false}
          className="border-t border-night-600 px-3.5 py-2 text-[12px] text-alarm"
        >
          {error}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
}

export const MermaidBlock = Mermaid.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
