import type { Point } from 'unist';

/** UTF-16 source positions with logarithmic offset lookup. */
export class SourceIndex {
  private readonly starts = [0];

  constructor(private readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\r') {
        if (source[i + 1] === '\n') i++;
        this.starts.push(i + 1);
      } else if (source[i] === '\n') {
        this.starts.push(i + 1);
      }
    }
  }

  toPoint(offset: number): Point | undefined {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.source.length)
      return;
    let low = 0;
    let high = this.starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (this.starts[mid] <= offset) low = mid;
      else high = mid;
    }
    return { line: low + 1, column: offset - this.starts[low] + 1, offset };
  }
}
