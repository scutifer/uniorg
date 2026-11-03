# Editor parsing fork

Based on rasendubi/uniorg at `4cc3cb0`. Existing author attribution, license,
full-parser API, and unified plugin behavior are preserved.

The `uniorg-parse` package adds immutable incremental parse states and synchronous
section reparsing. Ordinary edits reparse the smallest enclosing section;
heading-structure changes, preambles, and uncertain boundaries fall back to the
full grammar. All positions describe the current source before an update returns.
No delayed parse or stale presentation snapshot is used.

The parser also uses binary-search source-position lookup, cached regular
expressions, and independent mutable restriction sets copied from shared templates.

Run `make setup`, `make build`, and `make test`. The suite retains upstream
snapshots and compares incremental results against full parses through over 1,000
seeded edits. `make benchmark` reports full and incremental update costs plus the
amount of grammar input. Source copying and suffix-position updates still scale
with document size, and a single very large section can still require a large parse.

Built packages are distributed through GitHub release assets. `make pack` writes
the archive under `/tmp/uniorg-pack/`; consumers should pin the exact release URL
and package integrity. The inherited npm release workflow is restricted to the
upstream repository.
