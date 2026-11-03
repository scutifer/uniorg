import {
  createIncrementalParse,
  updateIncrementalParse,
  type OrgEdit,
} from './incremental.js';
import { parse } from './parser.js';
import { SourceIndex } from './source-index.js';
import { location } from 'vfile-location';

const options = {
  trackPosition: true,
  todoKeywords: ['TODO', 'DOING', 'DONE'],
};
const fixture = [
  '#+title: Test',
  '',
  '* TODO First :tag:',
  'SCHEDULED: <2026-11-03 Tue>',
  ':PROPERTIES:',
  ':ID: first',
  ':END:',
  '',
  'A *bold /nested/* paragraph with [[https://example.com][a link]] and $x^2$.',
  'Second line with [cite:@one; @two] and a footnote[fn:one].',
  '',
  '** Child',
  '- [ ] Item',
  '  - Nested item',
  '',
  '| Key | Value |',
  '|-----+-------|',
  '| a   | b     |',
  '',
  '#+CAPTION: Example',
  '#+begin_src js',
  'const x = 1;',
  '#+end_src',
  '',
  '#+begin_quote',
  'Quoted text.',
  '#+end_quote',
  '',
  '* Second',
  'Tail paragraph with unicode λ and 😀.',
  '',
  '[fn:one] A footnote.',
  '',
  '* Last',
  'Last paragraph.',
].join('\n');

function apply(source: string, edits: readonly OrgEdit[]) {
  let cursor = 0;
  let result = '';
  for (const edit of edits) {
    result += source.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  return result + source.slice(cursor);
}

describe('incremental Org parsing', () => {
  it('matches the full tree and source positions after ordinary section edits', () => {
    let state = createIncrementalParse(fixture, options);
    for (const [needle, insert] of [
      ['paragraph', 'changed '],
      ['Child', 'New '],
      ['const x', '// '],
      ['Item', 'New '],
      ['Last paragraph.', 'Tail '],
    ]) {
      const from = state.source.indexOf(needle);
      const edits = [{ from, to: from, insert }];
      const old = state;
      const serialized = JSON.stringify(old.tree);
      state = updateIncrementalParse(state, edits);
      expect(state.statistics.strategy).toBe('section');
      expect(state.statistics.parsedCharacters).toBeLessThan(
        state.source.length
      );
      expect(state.source).toBe(apply(old.source, edits));
      expect(state.tree).toEqual(parse(state.source, options));
      expect(JSON.stringify(old.tree)).toBe(serialized);
    }
  });

  it('updates EOF positions, same-length newline changes, and multiple cursors', () => {
    let state = createIncrementalParse(fixture, options);
    const changes = [
      [
        {
          from: state.source.length,
          to: state.source.length,
          insert: '\nNew tail',
        },
      ],
      [
        {
          from: fixture.indexOf('Tail paragraph'),
          to: fixture.indexOf('Tail paragraph') + 1,
          insert: '\n',
        },
      ],
    ];
    for (const edits of changes) {
      state = updateIncrementalParse(state, edits);
      expect(state.tree).toEqual(parse(state.source, options));
    }
    const from = state.source.indexOf('A *bold');
    const second = state.source.indexOf('Second line');
    state = updateIncrementalParse(state, [
      { from, to: from, insert: 'One ' },
      { from: second, to: second + 6, insert: 'Another' },
    ]);
    expect(state.tree).toEqual(parse(state.source, options));
  });

  it('uses the full grammar for changed heading structure, boundaries, and preambles', () => {
    for (const [needle, removed, insert] of [
      ['#+title', 0, 'Intro\n'],
      ['** Child', 1, ''],
      ['* Second', 0, 'Prefix '],
      ['A *bold', 0, '* Added\n'],
      ['Last paragraph.', 0, '* New\n'],
    ] as const) {
      const state = createIncrementalParse(fixture, options);
      const from = state.source.indexOf(needle);
      const updated = updateIncrementalParse(state, [
        { from, to: from + removed, insert },
      ]);
      expect(updated.statistics.strategy).toBe('full');
      expect(updated.tree).toEqual(parse(updated.source, options));
    }
  });

  it('preserves prefix identity and does not mutate suffix positions in previous states', () => {
    const old = createIncrementalParse(fixture, options);
    const before = JSON.stringify(old.tree);
    const from = fixture.indexOf('Tail paragraph');
    const next = updateIncrementalParse(old, [
      { from, to: from, insert: 'Extra\n' },
    ]);
    expect(next.tree.children[0]).toBe(old.tree.children[0]);
    expect(next.tree).toEqual(parse(next.source, options));
    expect(JSON.stringify(old.tree)).toBe(before);
  });

  it('validates edit coordinates and treats empty changes as an identity', () => {
    const state = createIncrementalParse(fixture);
    expect(updateIncrementalParse(state, [])).toBe(state);
    for (const edits of [
      [{ from: -1, to: 0, insert: '' }],
      [{ from: 0, to: fixture.length + 1, insert: '' }],
      [{ from: 2, to: 1, insert: '' }],
      [{ from: 2.5, to: 3, insert: '' }],
      [
        { from: 2, to: 4, insert: '' },
        { from: 3, to: 5, insert: '' },
      ],
    ])
      expect(() => updateIncrementalParse(state, edits)).toThrow(RangeError);
  });

  it('matches full parses through seeded edit sequences, including incomplete syntax', () => {
    let seed = 0x51c71fe;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const inserts = [
      'x',
      ' ',
      '\n',
      '*',
      '** New\n',
      '\n* New\n',
      '#+begin_src text\n',
      '#+end_src\n',
      ':END:',
      '[',
      ']',
      '/',
      '$',
      '😀',
      '\r\n',
      '\\',
      'TODO',
      '',
    ];
    let count = 0;
    let incremental = 0;
    for (let sequence = 0; sequence < 12; sequence++) {
      let state = createIncrementalParse(fixture, options);
      for (let step = 0; step < 120; step++) {
        const from = random(state.source.length + 1);
        const to = Math.min(state.source.length, from + random(8));
        const edits = [{ from, to, insert: inserts[random(inserts.length)] }];
        const source = apply(state.source, edits);
        let expected;
        try {
          expected = parse(source, options);
        } catch {
          continue;
        }
        state = updateIncrementalParse(state, edits);
        expect(
          state.tree,
          `sequence=${sequence}, step=${step}, edit=${JSON.stringify(edits)}`
        ).toEqual(expected);
        if (state.statistics.strategy === 'section') incremental++;
        count++;
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(incremental).toBeGreaterThan(100);
  });
});

describe('indexed source locations', () => {
  it('matches vfile-location for UTF-16, LF, CRLF, and CR positions', () => {
    for (const source of [
      '',
      '\n',
      '\r\n',
      '\r',
      fixture,
      'a\rb\r\nc\nλ😀\n',
    ]) {
      const fast = new SourceIndex(source);
      const reference = location(source);
      for (let offset = 0; offset <= source.length; offset++)
        expect(fast.toPoint(offset)).toEqual(reference.toPoint(offset));
      expect(fast.toPoint(-1)).toBeUndefined();
      expect(fast.toPoint(source.length + 1)).toBeUndefined();
    }
  });
});
