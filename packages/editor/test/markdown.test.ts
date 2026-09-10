import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentToMarkdown, markdownToDocument } from '../src/index.js';

function roundTrip(markdown: string): string {
  return documentToMarkdown(markdownToDocument(markdown));
}

describe('markdown round trip', () => {
  it('keeps inline formatting', () => {
    const source = 'Some **bold**, *italic*, ~~strike~~, <u>underline</u> and `code`.';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps text and background colors', () => {
    const source = 'A <span style="color:#ff5c5c;background-color:#2a2a2a">colored</span> run.';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps highlights', () => {
    assert.equal(
      roundTrip('Text with ==highlight== inside.').trim(),
      'Text with ==highlight== inside.',
    );
  });

  it('keeps paragraph alignment', () => {
    const source = '<p align="center">Centered with **bold**</p>';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps heading alignment', () => {
    const source = '<h2 align="right">Right aligned</h2>';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps task lists', () => {
    const source = '- [x] done\n- [ ] open';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps nested bullet lists', () => {
    const source = '- one\n- two\n  - nested';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps tables including column alignment', () => {
    const source = [
      '| Name | Role | Count |',
      '| --- | :---: | ---: |',
      '| Ada | admin | 3 |',
      '| Linus | editor | 7 |',
    ].join('\n');
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps fenced code blocks with their language', () => {
    const source = '```ts\nconst x: number = 1;\n```';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps mermaid diagrams', () => {
    const source = '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps plain images as markdown', () => {
    const source = '![plain image](https://example.com/a.png)';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps image sizing, alignment, wrapping and crop', () => {
    const source =
      '<img src="https://example.com/b.png" alt="fancy" width="320" data-align="center" data-wrap="right" data-crop="0.1,0.1,0.8,0.8" />';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps an image caption flag', () => {
    const source = '<img src="https://example.com/c.png" alt="A wide shot" data-caption="true" />';
    assert.equal(roundTrip(source).trim(), source);

    const doc = markdownToDocument(source);
    assert.equal(doc.firstChild?.attrs.showCaption, true);
  });

  it('leaves a plain image without a caption', () => {
    const doc = markdownToDocument('![just alt](https://example.com/d.png)');
    assert.equal(doc.firstChild?.attrs.showCaption, false);
    assert.equal(
      roundTrip('![just alt](https://example.com/d.png)').trim(),
      '![just alt](https://example.com/d.png)',
    );
  });

  it('keeps external and internal links apart', () => {
    const source =
      'External [link](https://example.com) and internal [doc](collaby:doc/1f4d3c2b-0000-4000-8000-000000000000).';
    const result = roundTrip(source).trim();
    assert.equal(result, source);

    const doc = markdownToDocument(source);
    const documentIds: (string | null)[] = [];
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === 'link') documentIds.push(mark.attrs.documentId as string | null);
      }
    });
    assert.deepEqual(documentIds, [null, '1f4d3c2b-0000-4000-8000-000000000000']);
  });

  it('keeps blockquotes', () => {
    const source = '> quoted text';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps ordered lists', () => {
    const source = '1. first\n2. second';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps callouts with a title', () => {
    const source = '> [!WARNING] Heads up\n> Do not delete this file.';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps callouts without a title', () => {
    const source = '> [!NOTE]\n> Just a note.';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps collapsed callouts', () => {
    const source = '> [!TIP]- Folded by default\n> Hidden until opened.';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('normalizes callout aliases to their canonical kind', () => {
    assert.equal(roundTrip('> [!caution] Careful\n> Body').trim(), '> [!WARNING] Careful\n> Body');
    assert.equal(roundTrip('> [!tldr]\n> Body').trim(), '> [!ABSTRACT]\n> Body');
  });

  it('keeps multi block callouts', () => {
    const source = '> [!INFO] Setup\n> First paragraph.\n>\n> - one\n> - two';
    assert.equal(roundTrip(source).trim(), source);
  });

  it('keeps a plain blockquote separate from a callout', () => {
    const doc = markdownToDocument('> plain quote');
    assert.equal(doc.firstChild?.type.name, 'blockquote');

    const callout = markdownToDocument('> [!NOTE]\n> hello');
    assert.equal(callout.firstChild?.type.name, 'callout');
    assert.equal(callout.firstChild?.attrs.kind, 'note');
  });

  it('is stable across a second pass', () => {
    const source = [
      '# Collaby',
      '',
      'Mixed **content** with <u>underline</u>.',
      '',
      '> quoted',
      '',
      '- [x] done',
      '',
      '| a | b |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '',
      '---',
    ].join('\n');
    const first = roundTrip(source);
    assert.equal(roundTrip(first), first);
  });
});
