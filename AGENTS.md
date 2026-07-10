# Project guidance

This package is a pi extension adapter that maps pi lifecycle events to peon notifications.

## Working style

- Use TypeScript for source files.
- Always re-read the relevant files before editing. Assume the user may have changed code between prompts.
- Prefer targeted edits over rewrites. Preserve user optimizations and naming unless explicitly asked to change them.
- Do not invent local type systems for pi APIs or Node APIs when the real types or simple test helpers are enough.
- Keep tests explicit about where expected values come from. Avoid hidden defaults that make assertions look like magic.
- Do not over-engineer diagnostics or test harnesses. Prefer the smallest boundary that proves the behavior.
- Keep imports extensionless inside `src`, e.g. `import { registerPiHandlers } from './pi'`.
- The main doc entrypoint for this project is `README.adoc`. A *README.md* is just auto-generated and should not be edited.

## Runtime behavior

- `src/index.ts` is the composition boundary
- `src/pi.ts` owns pi event mapping and guard decisions.
- `src/peon.ts` owns executable resolution and fire-and-forget child-process dispatch.

## Diagnostics expectations

- Debug logging is opt-in through `PI_PEON_ADAPTER_DEBUG_LOG`.
- Logging should be plain text key/value lines with timestamp and `[level]` after the timestamp.
- Levels:
  - `[info]` for hook receipt, send handoff, and other normal flow;
  - `[warn]` for intentional skips and timeout kills;
  - `[error]` for process or stdin failures.
- The main concerns are to receive pi events and forward them to the peon executable.

## Testing expectations

- Follow test-driven development for behavior-changing code: **red, green, refactor**. Add or update the test that
  exposes the issue or missing behavior, verify it fails for the right reason, then implement the change and clean up.
- Side-by-side unit tests live next to implementation files in `src/`.
- Broader real-wiring tests live in `test/integration.test.ts`.
- Use existing `test/helpers/` for unit tests. Ask the user if you detect something that should go there.
- Integration tests should mock as little as possible. Prefer real temp executables and real `spawn` when testing
  wiring.

## Development commands

Run these before handing off changes:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
```

Use formatting when needed:

```bash
npm run format
```

## Publishing

Releasing a new version and publishing to npm are human-only tasks. Do not run the
release script or any variant of it (including with flags such as `--dry-run`),
and do not run `npm publish`, under any circumstances. Ask the user to run these
themselves.

## Package notes

Published files are controlled by `.npmignore` (npm uses its default ignores plus any rules listed there). Test files are excluded automatically.

Runtime dependencies belong in `dependencies`; development-only tools belong in `devDependencies`. Pi-provided packages such as `@earendil-works/pi-coding-agent` should stay in `peerDependencies` with a `"*"` range.
