'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

type Align = 'start' | 'center' | 'end';

interface Placement {
  top: number;
  left: number;
}

const GAP = 6;
const EDGE_PADDING = 8;

export function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: Align;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const trigger = anchor.current;
    const content = panel.current;
    if (!trigger || !content) return;

    const rect = trigger.getBoundingClientRect();
    const width = content.offsetWidth;
    const height = content.offsetHeight;

    let left =
      align === 'start'
        ? rect.left
        : align === 'end'
          ? rect.right - width
          : rect.left + rect.width / 2 - width / 2;

    left = Math.min(
      Math.max(EDGE_PADDING, left),
      Math.max(EDGE_PADDING, window.innerWidth - width - EDGE_PADDING),
    );

    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - EDGE_PADDING) {
      top = Math.max(EDGE_PADDING, rect.top - height - GAP);
    }

    setPlacement({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={anchor} className="relative shrink-0">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panel}
              className={cn(
                'fixed z-[80] rounded-lg border border-night-600 bg-night-800 p-2 shadow-xl shadow-black/50',
                placement ? 'visible' : 'invisible',
                className,
              )}
              style={{ top: placement?.top ?? 0, left: placement?.left ?? 0 }}
            >
              {children({ close })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
