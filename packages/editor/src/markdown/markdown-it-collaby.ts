import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';

const ALIGNED_BLOCK_PATTERN =
  /^<(p|h[1-6])\s+align="(left|center|right|justify)"\s*>([\s\S]*?)<\/\1>\s*$/;

const STANDALONE_IMAGE_PATTERN = /^<img\s+([^>]*?)\/?>\s*$/i;

const HTML_ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;

const OPEN_TAG_PATTERN = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\/?>$/;
const CLOSE_TAG_PATTERN = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/;

export function parseHtmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null = HTML_ATTRIBUTE_PATTERN.exec(raw);
  while (match !== null) {
    const [, key, value] = match;
    if (key) attributes[key.toLowerCase()] = decodeHtmlEntities(value ?? '');
    match = HTML_ATTRIBUTE_PATTERN.exec(raw);
  }
  HTML_ATTRIBUTE_PATTERN.lastIndex = 0;
  return attributes;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseStyleDeclarations(style: string | undefined): Record<string, string> {
  if (!style) return {};
  const declarations: Record<string, string> = {};
  for (const chunk of style.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator === -1) continue;
    const key = chunk.slice(0, separator).trim().toLowerCase();
    const value = chunk.slice(separator + 1).trim();
    if (key && value) declarations[key] = value;
  }
  return declarations;
}

function alignedBlockRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  const line = state.src.slice(start, max);
  const match = ALIGNED_BLOCK_PATTERN.exec(line);
  if (!match) return false;
  if (silent) return true;

  const tag = match[1]!;
  const align = match[2]!;
  const content = (match[3] ?? '').trim();
  const isHeading = tag !== 'p';

  const open = state.push(isHeading ? 'heading_open' : 'paragraph_open', tag, 1);
  open.map = [startLine, startLine + 1];
  open.attrSet('align', align);

  const inline = state.push('inline', '', 0);
  inline.content = content;
  inline.map = [startLine, startLine + 1];
  inline.children = [];

  state.push(isHeading ? 'heading_close' : 'paragraph_close', tag, -1);
  state.line = startLine + 1;
  return true;
}

function standaloneImageRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  const line = state.src.slice(start, max);
  const match = STANDALONE_IMAGE_PATTERN.exec(line);
  if (!match) return false;
  if (silent) return true;

  const token = state.push('collaby_image', 'img', 0);
  token.map = [startLine, startLine + 1];
  token.attrs = Object.entries(parseHtmlAttributes(match[1] ?? ''));
  state.line = startLine + 1;
  return true;
}

function wrapTableCellContent(state: StateCore): boolean {
  const tokens = state.tokens;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const next = tokens[index + 1];
    if (!next || next.type !== 'inline') continue;

    const open = new state.Token('paragraph_open', 'p', 1);
    const style = parseStyleDeclarations(token.attrGet('style') ?? undefined);
    const align = style['text-align'];
    if (align) open.attrSet('align', align);

    const close = new state.Token('paragraph_close', 'p', -1);
    tokens.splice(index + 2, 0, close);
    tokens.splice(index + 1, 0, open);
  }
  return true;
}

const TASK_MARKER_PATTERN = /^\[([ xX])\]\s+/;

function convertTaskLists(state: StateCore): boolean {
  const tokens = state.tokens;

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.type !== 'bullet_list_open') continue;

    const closeIndex = findMatchingClose(tokens, index, 'bullet_list_open', 'bullet_list_close');
    if (closeIndex === -1) continue;

    const itemStarts = directListItems(tokens, index, closeIndex);
    if (itemStarts.length === 0) continue;

    const markers = itemStarts.map((itemIndex) => taskMarkerAt(tokens, itemIndex));
    if (markers.some((marker) => marker === null)) continue;

    tokens[index]!.type = 'collaby_task_list_open';
    tokens[closeIndex]!.type = 'collaby_task_list_close';

    itemStarts.forEach((itemIndex, position) => {
      const itemOpen = tokens[itemIndex]!;
      itemOpen.type = 'collaby_task_item_open';
      itemOpen.attrSet('checked', markers[position] ? 'true' : 'false');

      const itemClose = findMatchingClose(tokens, itemIndex, 'list_item_open', 'list_item_close');
      if (itemClose !== -1) tokens[itemClose]!.type = 'collaby_task_item_close';

      stripTaskMarker(tokens, itemIndex);
    });
  }

  return true;
}

function findMatchingClose(
  tokens: Token[],
  start: number,
  openType: string,
  closeType: string,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const type = tokens[index]!.type;
    if (type === openType) depth += 1;
    else if (type === closeType) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function directListItems(tokens: Token[], open: number, close: number): number[] {
  const items: number[] = [];
  let depth = 0;
  for (let index = open + 1; index < close; index += 1) {
    const type = tokens[index]!.type;
    if (type === 'list_item_open') {
      if (depth === 0) items.push(index);
      depth += 1;
    } else if (type === 'list_item_close') {
      depth -= 1;
    }
  }
  return items;
}

function taskMarkerAt(tokens: Token[], itemIndex: number): boolean | null {
  const inline = firstInlineOf(tokens, itemIndex);
  if (!inline) return null;
  const match = TASK_MARKER_PATTERN.exec(inline.content);
  if (!match) return null;
  return match[1]!.toLowerCase() === 'x';
}

function firstInlineOf(tokens: Token[], itemIndex: number): Token | null {
  const paragraph = tokens[itemIndex + 1];
  if (!paragraph || paragraph.type !== 'paragraph_open') return null;
  const inline = tokens[itemIndex + 2];
  return inline && inline.type === 'inline' ? inline : null;
}

function stripTaskMarker(tokens: Token[], itemIndex: number): void {
  const inline = firstInlineOf(tokens, itemIndex);
  if (!inline) return;
  inline.content = inline.content.replace(TASK_MARKER_PATTERN, '');
  const first = inline.children?.[0];
  if (first && first.type === 'text') {
    first.content = first.content.replace(TASK_MARKER_PATTERN, '');
  }
}

function liftBlockImages(state: StateCore): boolean {
  const tokens = state.tokens;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.type !== 'inline' || !token.children) continue;

    const images = token.children.filter((child) => child.type === 'image');
    if (images.length === 0) continue;

    token.children = token.children.filter((child) => child.type !== 'image');

    const lifted = images.map((image) => {
      const replacement = new state.Token('collaby_image', 'img', 0);
      replacement.attrs = [
        ['src', image.attrGet('src') ?? ''],
        ['alt', image.content ?? image.attrGet('alt') ?? ''],
      ];
      const title = image.attrGet('title');
      if (title) replacement.attrs.push(['title', title]);
      return replacement;
    });

    const closeIndex = findParagraphClose(tokens, index);
    tokens.splice(closeIndex + 1, 0, ...lifted);

    if (isInlineEmpty(token)) {
      tokens.splice(index - 1, 3);
    }
  }
  return true;
}

function findParagraphClose(tokens: Token[], inlineIndex: number): number {
  for (let index = inlineIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.nesting === -1) return index;
  }
  return inlineIndex;
}

function isInlineEmpty(token: Token): boolean {
  if (!token.children || token.children.length === 0) return true;
  return token.children.every(
    (child) => child.type === 'text' && child.content.trim().length === 0,
  );
}

const INLINE_TAG_TO_TOKEN: Record<string, string> = {
  u: 'collaby_underline',
  ins: 'collaby_underline',
  span: 'collaby_text_style',
  mark: 'collaby_highlight',
  strong: 'collaby_strong',
  b: 'collaby_strong',
  em: 'collaby_em',
  i: 'collaby_em',
  del: 'collaby_strike',
  s: 'collaby_strike',
};

function convertInlineHtml(state: StateCore): boolean {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue;
    token.children = token.children.flatMap((child) => convertInlineHtmlToken(state, child));
  }
  return true;
}

function convertInlineHtmlToken(state: StateCore, token: Token): Token[] {
  if (token.type !== 'html_inline') return [token];

  const raw = token.content.trim();

  if (/^<br\s*\/?>$/i.test(raw)) {
    return [new state.Token('hardbreak', 'br', 0)];
  }

  const closeMatch = CLOSE_TAG_PATTERN.exec(raw);
  if (closeMatch) {
    const mapped = INLINE_TAG_TO_TOKEN[closeMatch[1]!.toLowerCase()];
    if (!mapped) return [];
    return [new state.Token(`${mapped}_close`, closeMatch[1]!.toLowerCase(), -1)];
  }

  const openMatch = OPEN_TAG_PATTERN.exec(raw);
  if (openMatch) {
    const tag = openMatch[1]!.toLowerCase();

    if (tag === 'img') {
      const image = new state.Token('collaby_image', 'img', 0);
      image.attrs = Object.entries(parseHtmlAttributes(openMatch[2] ?? ''));
      return [image];
    }

    const mapped = INLINE_TAG_TO_TOKEN[tag];
    if (!mapped) return [];

    const created = new state.Token(`${mapped}_open`, tag, 1);
    created.attrs = Object.entries(parseHtmlAttributes(openMatch[2] ?? ''));
    return [created];
  }

  return [];
}

const CALLOUT_MARKER_PATTERN = /^\[!([A-Za-z]+)\]([+-])?[ \t]*(.*)$/;

function convertCallouts(state: StateCore): boolean {
  const tokens = state.tokens;

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.type !== 'blockquote_open') continue;

    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    if (!paragraph || paragraph.type !== 'paragraph_open') continue;
    if (!inline || inline.type !== 'inline') continue;

    const firstLine = inline.content.split('\n', 1)[0] ?? '';
    const match = CALLOUT_MARKER_PATTERN.exec(firstLine);
    if (!match) continue;

    const open = tokens[index]!;
    open.type = 'collaby_callout_open';
    open.attrSet('kind', match[1]!.toLowerCase());
    if (match[2] === '-') open.attrSet('collapsed', 'true');
    if (match[3] && match[3].trim().length > 0) open.attrSet('title', match[3].trim());

    const closeIndex = findMatchingClose(tokens, index, 'blockquote_open', 'blockquote_close');
    if (closeIndex !== -1) tokens[closeIndex]!.type = 'collaby_callout_close';

    stripMarkerLine(inline);

    if (isInlineEmpty(inline)) {
      tokens.splice(index + 1, 3);
    }
  }

  return true;
}

function stripMarkerLine(inline: Token): void {
  const newlineIndex = inline.content.indexOf('\n');
  inline.content = newlineIndex === -1 ? '' : inline.content.slice(newlineIndex + 1);

  if (!inline.children) return;

  const breakIndex = inline.children.findIndex(
    (child) => child.type === 'softbreak' || child.type === 'hardbreak',
  );

  inline.children = breakIndex === -1 ? [] : inline.children.slice(breakIndex + 1);
}

function retypeMermaidFences(state: StateCore): boolean {
  for (const token of state.tokens) {
    if (token.type === 'fence' && token.info.trim().toLowerCase() === 'mermaid') {
      token.type = 'collaby_mermaid';
    }
  }
  return true;
}

export function collabyMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before('html_block', 'collaby_aligned_block', alignedBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.block.ruler.before('html_block', 'collaby_standalone_image', standaloneImageRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.push('collaby_callouts', convertCallouts);
  md.core.ruler.push('collaby_mermaid_fence', retypeMermaidFences);
  md.core.ruler.push('collaby_task_lists', convertTaskLists);
  md.core.ruler.push('collaby_table_cell_paragraphs', wrapTableCellContent);
  md.core.ruler.push('collaby_inline_html', convertInlineHtml);
  md.core.ruler.push('collaby_lift_images', liftBlockImages);
}
