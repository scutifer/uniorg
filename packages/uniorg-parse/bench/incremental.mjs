import { readFileSync } from 'node:fs';
import { parse } from '../lib/parser.js';
import {
  createIncrementalParse,
  updateIncrementalParse,
} from '../lib/incremental.js';

const options = {
  trackPosition: true,
  todoKeywords: ['TODO', 'DOING', 'DONE', 'POSTPONED', 'DROPPED'],
};
const sources = process.argv[2]
  ? [readFileSync(process.argv[2], 'utf8')]
  : [100, 1000, 5000].map((count) =>
      Array.from(
        { length: count },
        (_, i) =>
          `* TODO Section ${i}\nA paragraph with *emphasis* and [[https://example.com][a link]].\nMore text to edit here.\n\n`
      ).join('')
    );

function measure(fn) {
  for (let i = 0; i < 5; i++) fn();
  const times = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { median_ms: +times[15].toFixed(3), p95_ms: +times[28].toFixed(3) };
}

for (const source of sources) {
  const state = createIncrementalParse(source, options);
  const paragraphs = [];
  function visit(node) {
    if (node.type === 'paragraph') paragraphs.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(state.tree);
  paragraphs.sort(
    (a, b) =>
      Math.abs(a.position.start.offset - source.length / 2) -
      Math.abs(b.position.start.offset - source.length / 2)
  );
  const paragraph = paragraphs[0];
  const from = paragraph
    ? paragraph.position.start.offset +
      Math.min(
        4,
        paragraph.position.end.offset - paragraph.position.start.offset
      )
    : source.length;
  const edit = { from, to: from, insert: 'edited ' };
  const next = updateIncrementalParse(state, [edit]);
  console.log(
    JSON.stringify({
      characters: source.length,
      full: measure(() => parse(next.source, options)),
      incremental: measure(() => updateIncrementalParse(state, [edit])),
      statistics: next.statistics,
    })
  );
}
