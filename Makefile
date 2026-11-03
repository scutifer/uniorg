.PHONY: setup build test benchmark pack format

setup:
	pnpm install --filter uniorg-parse... --ignore-scripts --frozen-lockfile

build:
	pnpm --filter uniorg build
	pnpm --filter uniorg-parse build

test:
	pnpm exec vitest run packages/uniorg-parse

benchmark: build
	node packages/uniorg-parse/bench/incremental.mjs "$(ORG_FILE)"

pack: build
	mkdir -p /tmp/uniorg-pack
	pnpm --filter uniorg-parse pack --pack-destination /tmp/uniorg-pack

format:
	pnpm exec prettier --write packages/uniorg-parse/src/incremental.ts packages/uniorg-parse/src/incremental.spec.ts packages/uniorg-parse/src/source-index.ts packages/uniorg-parse/src/reader.ts packages/uniorg-parse/src/utils.ts packages/uniorg-parse/src/index.ts packages/uniorg-parse/bench/incremental.mjs
