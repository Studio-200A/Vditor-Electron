# Vditor-Electron Project Instructions

## Product Positioning

Vditor-Electron is a local-first desktop Markdown editor powered by
Electron and Vditor. It edits ordinary Markdown files directly.

Do not expand it into a knowledge-base, cloud-sync, account-based,
or proprietary-document-format application.

## Architecture Boundaries

- Keep Vditor pinned to 3.11.3 unless a task explicitly authorizes an upgrade.
- Centralize all Vditor private DOM access in
  src/renderer/vditor-adapter.js.
- Do not introduce React, Vue, or another UI framework.
- Preserve contextIsolation: true and nodeIntegration: false.
- Do not rebuild all Vditor instances for presentation-only settings.
- Preserve user changes and unrelated worktree modifications.

## Required Verification

Run, as applicable:

- npm run format:check
- npm run lint
- npm run typecheck
- npm run check:vditor
- npm test
- npm run build
- npm run test:e2e

If Electron E2E cannot start because the execution environment forbids
Chromium single-instance sockets, report it as an environment limitation.
Do not report the application tests as failed unless an assertion ran and failed.

## Working Method

- Inspect the current implementation before applying a plan.
- Treat development plans as living specifications, not mechanical checklists.
- Keep behavior changes separate from refactoring when possible.
- Complete and verify one bounded stage before beginning another.
- Do not silently expand the requested scope.
