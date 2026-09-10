'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { MediaImage, type ImageAlign, type ImageCrop, type ImageWrap } from '@collaby/editor';
import { AlignCenter, AlignLeft, AlignRight, Check, Crop, Trash2, WrapText, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
const MIN_WIDTH = 80;
const MIN_CROP = 0.08;

type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded transition-colors',
        active ? 'bg-lull-400 text-night-900' : 'text-haze hover:bg-night-700 hover:text-moon',
      )}
    >
      {children}
    </button>
  );
}

function ImageView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const attrs = node.attrs as {
    src: string;
    alt: string | null;
    title: string | null;
    width: string | null;
    align: ImageAlign;
    wrap: ImageWrap;
    crop: ImageCrop | null;
  };

  const crop = attrs.crop ?? FULL_CROP;
  const source = api.resolveAssetUrl(attrs.src);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [draftCrop, setDraftCrop] = useState<ImageCrop>(crop);

  const displayWidth = attrs.width ? Number.parseInt(attrs.width, 10) : null;
  const editable = editor.isEditable;

  useEffect(() => {
    if (!cropping) setDraftCrop(crop);
  }, [crop, cropping]);

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const frame = frameRef.current;
      if (!frame) return;

      const startX = event.clientX;
      const startWidth = frame.getBoundingClientRect().width;
      const maxWidth = frame.parentElement?.getBoundingClientRect().width ?? 900;

      function onMove(moveEvent: PointerEvent) {
        const next = clamp(startWidth + (moveEvent.clientX - startX), MIN_WIDTH, maxWidth);
        updateAttributes({ width: String(Math.round(next)) });
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [updateAttributes],
  );

  const startCropDrag = useCallback(
    (event: React.PointerEvent, handle: CropHandle) => {
      event.preventDefault();
      event.stopPropagation();

      const surface = imageRef.current?.parentElement;
      if (!surface) return;

      const bounds = surface.getBoundingClientRect();
      const origin = { ...draftCrop };
      const startX = event.clientX;
      const startY = event.clientY;

      function onMove(moveEvent: PointerEvent) {
        const dx = (moveEvent.clientX - startX) / bounds.width;
        const dy = (moveEvent.clientY - startY) / bounds.height;

        if (handle === 'move') {
          setDraftCrop({
            ...origin,
            x: clamp(origin.x + dx, 0, 1 - origin.width),
            y: clamp(origin.y + dy, 0, 1 - origin.height),
          });
          return;
        }

        const right = origin.x + origin.width;
        const bottom = origin.y + origin.height;

        let { x, y, width, height } = origin;

        if (handle === 'nw' || handle === 'sw') {
          x = clamp(origin.x + dx, 0, right - MIN_CROP);
          width = right - x;
        } else {
          width = clamp(origin.width + dx, MIN_CROP, 1 - origin.x);
        }

        if (handle === 'nw' || handle === 'ne') {
          y = clamp(origin.y + dy, 0, bottom - MIN_CROP);
          height = bottom - y;
        } else {
          height = clamp(origin.height + dy, MIN_CROP, 1 - origin.y);
        }

        setDraftCrop({ x, y, width, height });
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [draftCrop],
  );

  function commitCrop() {
    const rounded: ImageCrop = {
      x: Number(draftCrop.x.toFixed(4)),
      y: Number(draftCrop.y.toFixed(4)),
      width: Number(draftCrop.width.toFixed(4)),
      height: Number(draftCrop.height.toFixed(4)),
    };

    const isFull =
      rounded.x === 0 && rounded.y === 0 && rounded.width === 1 && rounded.height === 1;
    updateAttributes({ crop: isFull ? null : rounded });
    setCropping(false);
  }

  const ratio = natural ? natural.height / natural.width : null;
  const isCropped = crop !== FULL_CROP;
  const intrinsic = displayWidth === null && !isCropped;
  const frameHeight =
    displayWidth && ratio ? (displayWidth * ratio * crop.height) / crop.width : undefined;

  return (
    <NodeViewWrapper
      as="figure"
      data-align={attrs.align}
      data-wrap={attrs.wrap}
      className={cn('collaby-figure group relative my-4', selected && 'is-selected')}
    >
      {editable && selected && !cropping ? (
        <div
          contentEditable={false}
          className="absolute -top-9 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-night-600 bg-night-800 p-1 shadow-lg shadow-black/40"
        >
          <ToolbarButton
            label="Align left"
            active={attrs.align === 'left'}
            onClick={() => updateAttributes({ align: 'left' })}
          >
            <AlignLeft size={13} />
          </ToolbarButton>
          <ToolbarButton
            label="Align center"
            active={attrs.align === 'center'}
            onClick={() => updateAttributes({ align: 'center' })}
          >
            <AlignCenter size={13} />
          </ToolbarButton>
          <ToolbarButton
            label="Align right"
            active={attrs.align === 'right'}
            onClick={() => updateAttributes({ align: 'right' })}
          >
            <AlignRight size={13} />
          </ToolbarButton>

          <span className="mx-1 h-4 w-px bg-night-600" />

          <ToolbarButton
            label="Wrap text around image"
            active={attrs.wrap !== 'none'}
            onClick={() =>
              updateAttributes({
                wrap: attrs.wrap === 'none' ? 'left' : attrs.wrap === 'left' ? 'right' : 'none',
              })
            }
          >
            <WrapText size={13} />
          </ToolbarButton>

          <ToolbarButton label="Crop" active={false} onClick={() => setCropping(true)}>
            <Crop size={13} />
          </ToolbarButton>

          <span className="mx-1 h-4 w-px bg-night-600" />

          <ToolbarButton label="Remove image" onClick={deleteNode}>
            <Trash2 size={13} />
          </ToolbarButton>
        </div>
      ) : null}

      {editable && cropping ? (
        <div
          contentEditable={false}
          className="absolute -top-9 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-night-600 bg-night-800 p-1 shadow-lg shadow-black/40"
        >
          <ToolbarButton label="Reset crop" onClick={() => setDraftCrop(FULL_CROP)}>
            <Crop size={13} />
          </ToolbarButton>
          <ToolbarButton label="Cancel crop" onClick={() => setCropping(false)}>
            <X size={13} />
          </ToolbarButton>
          <ToolbarButton label="Apply crop" active onClick={commitCrop}>
            <Check size={13} />
          </ToolbarButton>
        </div>
      ) : null}

      <div
        ref={frameRef}
        className={cn(
          'relative overflow-hidden rounded-md',
          selected && 'ring-2 ring-lull-400 ring-offset-2 ring-offset-night-900',
        )}
        style={{
          width: displayWidth ? `${displayWidth}px` : intrinsic ? 'fit-content' : undefined,
          height: cropping ? undefined : frameHeight,
          maxWidth: '100%',
        }}
      >
        <img
          ref={imageRef}
          src={source}
          alt={attrs.alt ?? ''}
          title={attrs.title ?? undefined}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className={cn('block h-auto select-none', intrinsic ? 'w-auto max-w-full' : 'w-full')}
          style={
            cropping
              ? undefined
              : {
                  width: `${100 / crop.width}%`,
                  maxWidth: 'none',
                  marginLeft: `${(-crop.x * 100) / crop.width}%`,
                  marginTop: ratio ? `${(-crop.y * 100 * ratio) / crop.width}%` : undefined,
                }
          }
          draggable={false}
        />

        {cropping ? (
          <div className="absolute inset-0" contentEditable={false}>
            <div className="absolute inset-0 bg-night-900/65" />
            <div
              className="absolute cursor-move border border-lull-400 shadow-[0_0_0_9999px_rgba(20,22,31,0.0)]"
              style={{
                left: `${draftCrop.x * 100}%`,
                top: `${draftCrop.y * 100}%`,
                width: `${draftCrop.width * 100}%`,
                height: `${draftCrop.height * 100}%`,
                backgroundImage: `url(${source})`,
                backgroundSize: `${100 / draftCrop.width}% ${100 / draftCrop.height}%`,
                backgroundPosition: `${(draftCrop.x / (1 - draftCrop.width || 1)) * 100}% ${
                  (draftCrop.y / (1 - draftCrop.height || 1)) * 100
                }%`,
              }}
              onPointerDown={(event) => startCropDrag(event, 'move')}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                <span
                  key={handle}
                  role="presentation"
                  onPointerDown={(event) => startCropDrag(event, handle)}
                  className={cn(
                    'absolute h-3 w-3 rounded-full border-2 border-night-900 bg-lull-400',
                    handle === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                    handle === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                    handle === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                    handle === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                  )}
                />
              ))}
            </div>
          </div>
        ) : null}

        {editable && !cropping ? (
          <span
            role="presentation"
            aria-hidden
            onPointerDown={startResize}
            className="absolute bottom-1 right-1 hidden h-4 w-4 cursor-ew-resize items-center justify-center rounded border border-night-500 bg-night-800/90 group-hover:flex"
          >
            <span className="h-2 w-2 rotate-45 border-b border-r border-haze" />
          </span>
        ) : null}
      </div>

      {attrs.alt ? (
        <figcaption className="mt-1.5 text-[12px] text-dusk">{attrs.alt}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}

export const ResizableImage = MediaImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
