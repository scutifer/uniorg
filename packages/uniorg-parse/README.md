# `uniorg-parse`

[Org-mode](https://orgmode.org/) parser compatible with [unified](https://github.com/unifiedjs/unified) ecosystem.

## Install

```sh
npm install uniorg-parse
```


## Use

```js
var unified = require('unified')
var createStream = require('unified-stream')
var uniorgParse = require('uniorg-parse')
var uniorg2rehype = require('uniorg-rehype')
var html = require('rehype-stringify')

var processor = unified().use(uniorgParse).use(uniorg2rehype).use(html)

process.stdin.pipe(createStream(processor)).pipe(process.stdout)
```


## API


### `processor().use(uniorgParse, [, options])`

Configure the `processor` to read Org as input and process **[uniorg](https://github.com/rasendubi/uniorg)** syntax trees.


### `parse(string[, options])`

Parse string.

```js
import { parse } from 'uniorg-parse/lib/parser';

console.log(parse('* example document'))
```


## License

[GNU General Public License v3.0 or later](./LICENSE)


## Incremental parsing in the scutifer fork

This fork adds synchronous editor parsing while preserving the upstream unified
plugin and the ordinary full parser. No timers or stale render snapshots are
required. Source offsets use UTF-16 code units, matching JavaScript strings.

```ts
import { createIncrementalParse, updateIncrementalParse } from 'uniorg-parse';

const before = createIncrementalParse('* Notes\nSome text.\n');
const after = updateIncrementalParse(before, [
  { from: 13, to: 17, insert: 'updated text' },
]);

console.log(after.tree, after.statistics);
```

Edits must be sorted, non-overlapping ranges in the previous source. The returned
state and tree are immutable snapshots: updating does not alter earlier trees.
Position tracking is always enabled, including citation offsets and embedded
planning timestamps. Unchanged prefix subtrees retain their identity.

Ordinary edits reparse the smallest containing section. Changing the sequence of
heading levels, editing the document preamble, or touching an uncertain section
boundary uses the full grammar synchronously. This first implementation does not
provide incremental parsing within a single large section. Constructing the new
source and updating absolute positions in suffix nodes still scale with document
size; `statistics.parsedCharacters` measures grammar input, not total update work.

The fork also indexes source lines for binary-search position lookup, caches
parser regular expressions, and copies mutable restrictions from shared
read-only templates. Existing full-parser snapshots remain the reference.

From the repository root, run `make setup`, `make build`, and `make test`.
`make benchmark` measures synthetic documents; `make benchmark ORG_FILE=/path/to/file.org`
reads a local file without writing it or printing its contents. Differential tests
compare incremental results with full parsing through more than 1,000 seeded
edits, including incomplete syntax, Unicode, newline changes, and multiple edits.

GitHub release assets contain the built `uniorg-parse` package. Consumers should
pin an exact release URL and keep the package-manager integrity lock. The source
and existing GPL-3.0-or-later license remain in this repository.
