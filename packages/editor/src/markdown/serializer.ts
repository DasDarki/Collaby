import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import { normalizeCalloutKind } from '../extensions/callout.js';
import { parseInternalHref } from '../extensions/document-link.js';

type NodeSerializer = (
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  parent: ProseMirrorNode,
  index: number,
) => void;

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function alignmentOf(node: ProseMirrorNode): string | null {
  const align = node.attrs.textAlign as string | null | undefined;
  if (!align || align === 'left') return null;
  return align;
}

function writeAligned(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  tag: string,
  render: () => void,
): void {
  const align = alignmentOf(node);
  if (!align) {
    render();
    return;
  }
  state.write(`<${tag} align="${align}">`);
  state.renderInline(node);
  state.write(`</${tag}>`);
  state.closeBlock(node);
}

function serializeImage(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  const { src, alt, title, width, height, align, wrap, crop, assetId, showCaption } =
    node.attrs as Record<string, unknown>;
  const needsHtml =
    Boolean(width) ||
    Boolean(height) ||
    Boolean(crop) ||
    Boolean(showCaption) ||
    (typeof align === 'string' && align !== 'left') ||
    (typeof wrap === 'string' && wrap !== 'none');

  if (!needsHtml) {
    state.write(
      `![${state.esc(String(alt ?? ''))}](${String(src ?? '')}${
        title ? ` ${JSON.stringify(String(title))}` : ''
      })`,
    );
    state.closeBlock(node);
    return;
  }

  const attributes: string[] = [`src="${escapeHtmlAttribute(String(src ?? ''))}"`];
  if (alt) attributes.push(`alt="${escapeHtmlAttribute(String(alt))}"`);
  if (title) attributes.push(`title="${escapeHtmlAttribute(String(title))}"`);
  if (width) attributes.push(`width="${escapeHtmlAttribute(String(width))}"`);
  if (height) attributes.push(`height="${escapeHtmlAttribute(String(height))}"`);
  if (typeof align === 'string' && align !== 'left') attributes.push(`data-align="${align}"`);
  if (typeof wrap === 'string' && wrap !== 'none') attributes.push(`data-wrap="${wrap}"`);
  if (showCaption) attributes.push('data-caption="true"');
  if (crop && typeof crop === 'object') {
    const box = crop as { x: number; y: number; width: number; height: number };
    attributes.push(`data-crop="${box.x},${box.y},${box.width},${box.height}"`);
  }
  if (assetId) attributes.push(`data-asset-id="${escapeHtmlAttribute(String(assetId))}"`);

  state.write(`<img ${attributes.join(' ')} />`);
  state.closeBlock(node);
}

function serializeTable(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  const rows: string[][] = [];
  const alignments: string[] = [];

  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell, _offset, cellIndex) => {
      cells.push(serializeCell(cell));
      if (rows.length === 0) {
        alignments[cellIndex] = cellAlignment(cell);
      }
    });
    rows.push(cells);
  });

  if (rows.length === 0) return;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const header = rows[0] ?? [];
  const paddedHeader = Array.from({ length: columnCount }, (_, index) => header[index] ?? '');

  state.write(`| ${paddedHeader.join(' | ')} |`);
  state.ensureNewLine();

  const divider = Array.from({ length: columnCount }, (_, index) => {
    switch (alignments[index]) {
      case 'center':
        return ':---:';
      case 'right':
        return '---:';
      default:
        return '---';
    }
  });
  state.write(`| ${divider.join(' | ')} |`);
  state.ensureNewLine();

  for (const row of rows.slice(1)) {
    const padded = Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
    state.write(`| ${padded.join(' | ')} |`);
    state.ensureNewLine();
  }

  state.closeBlock(node);
}

function cellAlignment(cell: ProseMirrorNode): string {
  const paragraph = cell.firstChild;
  const align = paragraph?.attrs.textAlign as string | undefined;
  return align && align !== 'left' ? align : 'left';
}

function withoutAlignment(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText || node.isLeaf) return node;

  const children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(withoutAlignment(child)));

  const attrs = 'textAlign' in node.attrs ? { ...node.attrs, textAlign: 'left' } : node.attrs;

  return node.type.create(attrs, Fragment.fromArray(children), node.marks);
}

function serializeCell(cell: ProseMirrorNode): string {
  const rendered = collabyMarkdownSerializer.serialize(withoutAlignment(cell), {
    tightLists: true,
  });
  return rendered.trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|');
}

const nodes: Record<string, NodeSerializer> = {
  doc(state, node) {
    state.renderContent(node);
  },

  paragraph(state, node) {
    writeAligned(state, node, 'p', () => {
      state.renderInline(node);
      state.closeBlock(node);
    });
  },

  text(state, node) {
    state.text(node.text ?? '', true);
  },

  heading(state, node) {
    const level = Number(node.attrs.level ?? 1);
    writeAligned(state, node, `h${level}`, () => {
      state.write(`${'#'.repeat(level)} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    });
  },

  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },

  callout(state, node) {
    const kind = normalizeCalloutKind(node.attrs.kind as string | null).toUpperCase();
    const fold = node.attrs.collapsed ? '-' : '';
    const title = (node.attrs.title as string | null)?.trim();

    state.wrapBlock('> ', null, node, () => {
      state.write(`[!${kind}]${fold}${title ? ` ${title}` : ''}`);
      state.ensureNewLine();
      state.renderContent(node);
    });
  },

  horizontalRule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },

  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i += 1) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },

  codeBlock(state, node) {
    const language = (node.attrs.language as string | null) ?? '';
    state.write(`\`\`\`${language}\n`);
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  mermaid(state, node) {
    state.write('```mermaid\n');
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  orderedList(state, node) {
    const start = Number(node.attrs.start ?? 1);
    const maxWidth = String(start + node.childCount - 1).length;
    const space = ' '.repeat(maxWidth + 2);
    state.renderList(node, space, (index) => {
      const label = String(start + index);
      return `${' '.repeat(maxWidth - label.length)}${label}. `;
    });
  },

  listItem(state, node) {
    state.renderContent(node);
  },

  taskList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  taskItem(state, node) {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },

  image(state, node) {
    serializeImage(state, node);
  },

  table(state, node) {
    serializeTable(state, node);
  },

  tableRow(state, node) {
    state.renderContent(node);
  },

  tableCell(state, node) {
    state.renderContent(node);
  },

  tableHeader(state, node) {
    state.renderContent(node);
  },
};

const marks: ConstructorParameters<typeof MarkdownSerializer>[1] = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },

  code: {
    open(_state, _mark, parent, index) {
      return backticksFor(parent.child(index), -1);
    },
    close(_state, _mark, parent, index) {
      return backticksFor(parent.child(index - 1), 1);
    },
    escape: false,
  },

  textStyle: {
    open(_state, mark) {
      const color = mark.attrs.color as string | null;
      const backgroundColor = mark.attrs.backgroundColor as string | null;
      const fontSize = mark.attrs.fontSize as string | null;
      const declarations: string[] = [];
      if (color) declarations.push(`color:${color}`);
      if (backgroundColor) declarations.push(`background-color:${backgroundColor}`);
      if (fontSize) declarations.push(`font-size:${fontSize}`);
      if (declarations.length === 0) return '';
      return `<span style="${declarations.join(';')}">`;
    },
    close(_state, mark) {
      const hasStyle = mark.attrs.color || mark.attrs.backgroundColor || mark.attrs.fontSize;
      return hasStyle ? '</span>' : '';
    },
    mixable: true,
  },

  highlight: {
    open(_state, mark) {
      const color = mark.attrs.color as string | null;
      return color ? `<mark style="background-color:${color}">` : '==';
    },
    close(_state, mark) {
      const color = mark.attrs.color as string | null;
      return color ? '</mark>' : '==';
    },
    mixable: true,
  },

  link: {
    open() {
      return '[';
    },
    close(_state, mark) {
      const href = String(mark.attrs.href ?? '');
      const documentId = (mark.attrs.documentId as string | null) ?? parseInternalHref(href);
      const target = documentId ? `collaby:doc/${documentId}` : href;
      const title = mark.attrs.title as string | null;
      return `](${target.replace(/[()]/g, '\\$&')}${
        title ? ` "${title.replace(/"/g, '\\"')}"` : ''
      })`;
    },
    mixable: true,
  },

  commentAnchor: { open: '', close: '', mixable: true },
};

function backticksFor(node: ProseMirrorNode, side: number): string {
  const matches = /`+/g;
  let length = 0;
  if (node.isText && node.text) {
    let match: RegExpExecArray | null = matches.exec(node.text);
    while (match !== null) {
      length = Math.max(length, match[0].length);
      match = matches.exec(node.text);
    }
  }
  let result = length > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < length; i += 1) result += '`';
  if (length > 0 && side < 0) result += ' ';
  return result;
}

export const collabyMarkdownSerializer = new MarkdownSerializer(nodes, marks, {
  strict: false,
});

export function documentToMarkdown(doc: ProseMirrorNode): string {
  return collabyMarkdownSerializer.serialize(doc, { tightLists: true });
}
