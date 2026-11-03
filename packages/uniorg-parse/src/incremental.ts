import type { OrgData, OrgNode, Section } from 'uniorg';
import type { Position } from 'unist';
import { parse } from './parser.js';
import type { ParseOptions } from './parse-options.js';
import { SourceIndex } from './source-index.js';

export interface OrgEdit {
  /** Offsets refer to the previous source, in UTF-16 code units. */
  from: number;
  to: number;
  insert: string;
}

export interface IncrementalParseStatistics {
  strategy: 'full' | 'section';
  /** Amount of source passed to the grammar, excluding reused syntax. */
  parsedCharacters: number;
  /** Reparsed range in the new source. */
  from: number;
  to: number;
}

export interface IncrementalParseState {
  readonly source: string;
  /** Treat published trees as immutable; updates never mutate older trees. */
  readonly tree: OrgData;
  readonly statistics: Readonly<IncrementalParseStatistics>;
}

interface StateData {
  options: Partial<ParseOptions>;
}
const stateData = new WeakMap<IncrementalParseState, StateData>();

function publish(
  source: string,
  tree: OrgData,
  options: Partial<ParseOptions>,
  statistics: IncrementalParseStatistics
): IncrementalParseState {
  const state = Object.freeze({
    source,
    tree,
    statistics: Object.freeze(statistics),
  });
  stateData.set(state, { options });
  return state;
}

function fullParse(
  source: string,
  options: Partial<ParseOptions>
): IncrementalParseState {
  return publish(source, parse(source, options), options, {
    strategy: 'full',
    parsedCharacters: source.length,
    from: 0,
    to: source.length,
  });
}

/** Create an editor parse. Position tracking is always enabled. */
export function createIncrementalParse(
  source: string,
  options: Partial<ParseOptions> = {}
): IncrementalParseState {
  const settings: Partial<ParseOptions> = { ...options, trackPosition: true };
  if (options.todoKeywords) settings.todoKeywords = [...options.todoKeywords];
  if (options.linkTypes) settings.linkTypes = [...options.linkTypes];
  if (options.emphasisRegexpComponents)
    settings.emphasisRegexpComponents = { ...options.emphasisRegexpComponents };
  return fullParse(source, settings);
}

function applyEdits(source: string, edits: readonly OrgEdit[]): string {
  let cursor = 0;
  const pieces: string[] = [];
  for (const edit of edits) {
    if (
      !Number.isSafeInteger(edit.from) ||
      !Number.isSafeInteger(edit.to) ||
      edit.from < cursor ||
      edit.to < edit.from ||
      edit.to > source.length ||
      typeof edit.insert !== 'string'
    ) {
      throw new RangeError(
        'Org edits must be ordered, non-overlapping UTF-16 ranges in the previous source'
      );
    }
    pieces.push(source.slice(cursor, edit.from), edit.insert);
    cursor = edit.to;
  }
  pieces.push(source.slice(cursor));
  return pieces.join('');
}

function affectedHeadings(source: string, from: number, to: number): string {
  const start = source.lastIndexOf('\n', from - 1) + 1;
  const newline = source.indexOf('\n', to);
  const end = newline < 0 ? source.length : newline;
  return Array.from(
    source.slice(start, end).matchAll(/^(\*+)[ \t]/gm),
    (match) => match[1].length
  ).join(',');
}

function containingSection(
  node: OrgNode,
  from: number,
  to: number,
  length: number
): Section | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || from < start || to > end)
    return;
  let result: Section | undefined;
  // Inserting before a section's heading, or at the next sibling's start, can
  // change which section owns the whitespace. Use the full grammar there.
  if (node.type === 'section' && from > start && (to < end || end === length))
    result = node;
  if ('children' in node) {
    for (const child of node.children) {
      const nested = containingSection(child, from, to, length);
      if (nested) return nested;
    }
  }
  return result;
}

type OffsetMapper = (offset: number) => number;

/** Copy positions in changed ancestors/tail nodes while sharing the prefix. */
function relocate<T>(
  value: T,
  mapOffset: OffsetMapper,
  index: SourceIndex,
  replacement?: { old: Section; fresh: Section }
): T {
  if (replacement && value === replacement.old) return replacement.fresh as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((child) => {
      const next = relocate(child, mapOffset, index, replacement);
      changed ||= next !== child;
      return next;
    });
    return (changed ? result : value) as T;
  }
  const object = value as Record<string, any>;
  if (
    replacement &&
    object.position?.end.offset <= replacement.old.position!.start.offset!
  )
    return value;
  const result: Record<string, any> = {};
  let changed = false;
  for (const [key, child] of Object.entries(object)) {
    let next: unknown;
    if (
      key === 'position' &&
      child?.start?.offset !== undefined &&
      child?.end?.offset !== undefined
    ) {
      const position = child as Position;
      const start = mapOffset(position.start.offset!);
      const end = mapOffset(position.end.offset!);
      const startPoint = index.toPoint(start)!;
      const endPoint = index.toPoint(end)!;
      next =
        start === position.start.offset &&
        end === position.end.offset &&
        startPoint.line === position.start.line &&
        startPoint.column === position.start.column &&
        endPoint.line === position.end.line &&
        endPoint.column === position.end.column
          ? child
          : { start: startPoint, end: endPoint };
    } else if (
      (key === 'contentsBegin' ||
        key === 'contentsEnd' ||
        key === 'begin' ||
        key === 'end') &&
      typeof child === 'number'
    ) {
      next = mapOffset(child);
    } else {
      next = relocate(child, mapOffset, index, replacement);
    }
    result[key] = next;
    changed ||= next !== child;
  }
  return (changed ? result : value) as T;
}

/**
 * Reparse the smallest enclosing section when heading boundaries are stable.
 * Structural boundary changes and preamble edits use a synchronous full parse.
 * Edits are ordered, non-overlapping, and refer to the previous source.
 */
export function updateIncrementalParse(
  previous: IncrementalParseState,
  edits: readonly OrgEdit[]
): IncrementalParseState {
  const data = stateData.get(previous);
  if (!data)
    throw new TypeError('Expected a state returned by createIncrementalParse');
  if (edits.length === 0) return previous;
  const source = applyEdits(previous.source, edits);
  if (source === previous.source) return previous;
  const from = edits[0].from;
  const to = edits[edits.length - 1].to;
  const delta = source.length - previous.source.length;
  const section = containingSection(
    previous.tree,
    from,
    to,
    previous.source.length
  );
  if (
    !section ||
    affectedHeadings(previous.source, from, to) !==
      affectedHeadings(source, from, to + delta)
  ) {
    return fullParse(source, data.options);
  }
  const start = section.position!.start.offset!;
  const end = section.position!.end.offset! + delta;
  const fragment = source.slice(start, end);
  let parsed: OrgData;
  try {
    parsed = parse(fragment, data.options);
  } catch {
    return fullParse(source, data.options);
  }
  const fresh = parsed.children[0];
  if (
    parsed.children.length !== 1 ||
    fresh?.type !== 'section' ||
    fresh.position?.start.offset !== 0 ||
    fresh.position?.end.offset !== fragment.length
  ) {
    return fullParse(source, data.options);
  }
  const index = new SourceIndex(source);
  const absolute = relocate(fresh, (offset) => start + offset, index);
  const mapOffset = (offset: number) =>
    offset < from ? offset : offset >= to ? offset + delta : from;
  const tree = relocate(previous.tree, mapOffset, index, {
    old: section,
    fresh: absolute,
  });
  return publish(source, tree, data.options, {
    strategy: 'section',
    parsedCharacters: fragment.length,
    from: start,
    to: end,
  });
}
