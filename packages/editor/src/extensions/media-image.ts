import Image from '@tiptap/extension-image';

export type ImageAlign = 'left' | 'center' | 'right';
export type ImageWrap = 'none' | 'left' | 'right';

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaImage: {
      updateImageAttributes: (attributes: Record<string, unknown>) => ReturnType;
    };
  }
}

function parseCrop(value: string | null): ImageCrop | null {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number.parseFloat(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

function serializeCrop(crop: ImageCrop | null): string | null {
  if (!crop) return null;
  return `${crop.x},${crop.y},${crop.width},${crop.height}`;
}

export const MediaImage = Image.extend({
  name: 'image',
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute('width') ?? element.style.width ?? null,
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute('height') ?? null,
        renderHTML: (attributes) =>
          attributes.height ? { height: String(attributes.height) } : {},
      },
      align: {
        default: 'left' as ImageAlign,
        parseHTML: (element) => element.getAttribute('data-align') ?? 'left',
        renderHTML: (attributes) => ({ 'data-align': attributes.align ?? 'left' }),
      },
      wrap: {
        default: 'none' as ImageWrap,
        parseHTML: (element) => element.getAttribute('data-wrap') ?? 'none',
        renderHTML: (attributes) => ({ 'data-wrap': attributes.wrap ?? 'none' }),
      },
      crop: {
        default: null as ImageCrop | null,
        parseHTML: (element) => parseCrop(element.getAttribute('data-crop')),
        renderHTML: (attributes) => {
          const crop = serializeCrop(attributes.crop as ImageCrop | null);
          return crop ? { 'data-crop': crop } : {};
        },
      },
      showCaption: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-caption') === 'true',
        renderHTML: (attributes) => (attributes.showCaption ? { 'data-caption': 'true' } : {}),
      },
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-asset-id'),
        renderHTML: (attributes) =>
          attributes.assetId ? { 'data-asset-id': attributes.assetId } : {},
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      updateImageAttributes:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },
}).configure({
  inline: false,
  allowBase64: false,
});
