import Link from '@tiptap/extension-link';

export const INTERNAL_LINK_SCHEME = 'collaby:doc/';

export function internalHref(documentId: string): string {
  return `${INTERNAL_LINK_SCHEME}${documentId}`;
}

export function parseInternalHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(INTERNAL_LINK_SCHEME)) return null;
  const id = href.slice(INTERNAL_LINK_SCHEME.length).trim();
  return id.length > 0 ? id : null;
}

export function isExternalHref(href: string | null | undefined): boolean {
  if (!href) return false;
  return !parseInternalHref(href) && /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export const DocumentLink = Link.extend({
  name: 'link',
  inclusive: false,

  addAttributes() {
    return {
      ...this.parent?.(),
      documentId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-document-id') ??
          parseInternalHref(element.getAttribute('href')),
        renderHTML: (attributes) =>
          attributes.documentId ? { 'data-document-id': attributes.documentId } : {},
      },
    };
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  protocols: ['http', 'https', 'mailto', 'collaby'],
  HTMLAttributes: {
    rel: 'noopener noreferrer',
    class: 'collaby-link',
  },
});
