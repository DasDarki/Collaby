'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

const EDGE_PADDING = 8;

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export function ContextMenu({
  position,
  onClose,
  className,
  children,
}: {
  position: ContextMenuPosition | null;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ContextMenuPosition | null>(null);

  useLayoutEffect(() => {
    const content = panel.current;
    if (!position || !content) {
      setPlacement(null);
      return;
    }

    const width = content.offsetWidth;
    const height = content.offsetHeight;

    setPlacement({
      x: Math.min(Math.max(EDGE_PADDING, position.x), window.innerWidth - width - EDGE_PADDING),
      y: Math.min(Math.max(EDGE_PADDING, position.y), window.innerHeight - height - EDGE_PADDING),
    });
  }, [position]);

  useEffect(() => {
    if (!position) return;

    function onPointerDown(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [position, onClose]);

  if (!position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panel}
      role="menu"
      className={cn(
        'fixed z-[85] rounded-lg border border-night-600 bg-night-800 p-2 shadow-xl shadow-black/50',
        placement ? 'visible' : 'invisible',
        className,
      )}
      style={{ left: placement?.x ?? position.x, top: placement?.y ?? position.y }}
    >
      {children}
    </div>,
    document.body,
  );
}
