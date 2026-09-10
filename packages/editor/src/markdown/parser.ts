import MarkdownIt from 'markdown-it';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { MarkdownParser } from 'prosemirror-markdown';
import { collabySchema } from '../schema.js';
import { parseInternalHref } from '../extensions/document-link.js';
import {
  collabyMarkdownItPlugin,
  parseHtmlAttributes,
  parseStyleDeclarations,
} from './markdown-it-collaby.js';

type TokenLike = {
  attrGet: (name: string) => string | null;
  content: string;
  tag: string;
  info: string;
  markup: string;
};

function attributeOf(token: TokenLike, name: string): string | null {
  return token.attrGet(name);
}

function alignmentAttribute(token: TokenLike): string {
  return attributeOf(token, 'align') ?? 'left';
}

function parseCropAttribute(value: string | null) {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number.parseFloat(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

export function createMarkdownTokenizer(): MarkdownIt {
  return MarkdownIt('commonmark', { html: true, linkify: true, breaks: false })
    .enable(['table', 'strikethrough', 'linkify'])
    .use(collabyMarkdownItPlugin);
}

const tokenSpec = {
  blockquote: { block: 'blockquote' },
  collaby_callout: {
    block: 'callout',
    getAttrs: (token: TokenLike) => ({
      kind: attributeOf(token, 'kind') ?? 'note',
      title: attributeOf(token, 'title'),
      collapsed: attributeOf(token, 'collapsed') === 'true',
    }),
  },
  paragraph: {
    block: 'paragraph',
    getAttrs: (token: TokenLike) => ({ textAlign: alignmentAttribute(token) }),
  },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList', getAttrs: () => ({}) },
  ordered_list: {
    block: 'orderedList',
    getAttrs: (token: TokenLike) => ({
      start: Number(attributeOf(token, 'start') ?? 1),
    }),
  },
  heading: {
    block: 'heading',
    getAttrs: (token: TokenLike) => ({
      level: Number(token.tag.slice(1)),
      textAlign: alignmentAttribute(token),
    }),
  },
  code_block: {
    block: 'codeBlock',
    noCloseToken: true,
    getAttrs: () => ({ language: null }),
  },
  fence: {
    block: 'codeBlock',
    noCloseToken: true,
    getAttrs: (token: TokenLike) => ({ language: token.info.trim() || null }),
  },
  collaby_mermaid: { block: 'mermaid', noCloseToken: true },
  collaby_task_list: { block: 'taskList' },
  collaby_task_item: {
    block: 'taskItem',
    getAttrs: (token: TokenLike) => ({ checked: attributeOf(token, 'checked') === 'true' }),
  },
  hr: { node: 'horizontalRule' },
  collaby_image: {
    node: 'image',
    getAttrs: (token: TokenLike) => ({
      src: attributeOf(token, 'src') ?? '',
      alt: attributeOf(token, 'alt'),
      title: attributeOf(token, 'title'),
      width: attributeOf(token, 'width'),
      height: attributeOf(token, 'height'),
      align: attributeOf(token, 'data-align') ?? 'left',
      wrap: attributeOf(token, 'data-wrap') ?? 'none',
      crop: parseCropAttribute(attributeOf(token, 'data-crop')),
      assetId: attributeOf(token, 'data-asset-id'),
    }),
  },
  hardbreak: { node: 'hardBreak' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'tableRow' },
  th: {
    block: 'tableHeader',
    getAttrs: (token: TokenLike) => ({
      colspan: 1,
      rowspan: 1,
      colwidth: null,
    }),
  },
  td: {
    block: 'tableCell',
    getAttrs: () => ({ colspan: 1, rowspan: 1, colwidth: null }),
  },
  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  s: { mark: 'strike' },
  link: {
    mark: 'link',
    getAttrs: (token: TokenLike) => {
      const href = attributeOf(token, 'href') ?? '';
      return {
        href,
        title: attributeOf(token, 'title'),
        documentId: parseInternalHref(href),
      };
    },
  },
  code_inline: { mark: 'code', noCloseToken: true },
  collaby_underline: { mark: 'underline' },
  collaby_strong: { mark: 'bold' },
  collaby_em: { mark: 'italic' },
  collaby_strike: { mark: 'strike' },
  collaby_highlight: {
    mark: 'highlight',
    getAttrs: (token: TokenLike) => {
      const style = parseStyleDeclarations(attributeOf(token, 'style') ?? undefined);
      return { color: style['background-color'] ?? null };
    },
  },
  collaby_text_style: {
    mark: 'textStyle',
    getAttrs: (token: TokenLike) => {
      const style = parseStyleDeclarations(attributeOf(token, 'style') ?? undefined);
      return {
        color: style.color ?? null,
        backgroundColor: style['background-color'] ?? null,
        fontSize: style['font-size'] ?? null,
      };
    },
  },
  html_block: { ignore: true },
  html_inline: { ignore: true },
} as const;

let cachedParser: MarkdownParser | null = null;

export function collabyMarkdownParser(): MarkdownParser {
  if (!cachedParser) {
    cachedParser = new MarkdownParser(
      collabySchema(),
      createMarkdownTokenizer(),
      tokenSpec as never,
    );
  }
  return cachedParser;
}

export function markdownToDocument(markdown: string): ProseMirrorNode {
  return collabyMarkdownParser().parse(markdown);
}
