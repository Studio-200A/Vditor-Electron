# Vditor-Electron Project Instructions

## Product Positioning

Vditor-Electron is a local-first desktop Markdown editor powered by
Electron and Vditor. It edits ordinary Markdown files directly.

Do not expand it into a knowledge-base, cloud-sync, account-based,
or proprietary-document-format application.

The product is a desktop host and experience layer for Vditor. Keep
Markdown editing, rendering, and the three editing modes delegated to
Vditor; keep desktop windows, files, workspaces, settings, localization,
and platform behavior in the application layer.

## Architecture Boundaries

- Keep Vditor pinned to 3.11.3 unless a task explicitly authorizes an upgrade.
- Centralize all Vditor private DOM access in
  src/renderer/vditor-adapter.js.
- Do not introduce React, Vue, or another UI framework.
- Do not add Monaco, CodeMirror, or another competing editor engine to
  replace or overlay Vditor's editing modes without an explicit architecture
  decision.
- Preserve contextIsolation: true and nodeIntegration: false.
- Do not rebuild all Vditor instances for presentation-only settings.
- Keep Vditor's private DOM selectors, structural assumptions, and DOM
  workarounds in `src/renderer/vditor-adapter.js`. The rest of the renderer
  may consume adapter APIs, but must not query Vditor internals directly.
- Keep the bundled Vditor assets offline. Changes to the asset-copy process,
  CDN configuration, or the pinned Vditor version require updating the
  Vditor check and upgrade documentation.
- Preserve user changes and unrelated worktree modifications.

## Security and data boundaries

- Keep `contextIsolation: true`, `nodeIntegration: false`, and the preload
  API narrow; expose capabilities through explicit context-bridge methods.
- Treat Markdown files, image paths, and external links as untrusted input.
  Resolve local resources through the application protocol and use Electron's
  shell APIs for external navigation.
- Keep TOML configuration separate from Chromium user data using the
  platform paths implemented by `src/main/app-paths.ts`.
- Do not add telemetry, cloud synchronization, accounts, or background upload
  behavior without an explicit product decision.

## Localization

- Use the locale keys in `src/renderer/locales.js` for user-visible text,
  labels, titles, tooltips, dialogs, menus, and empty states.
- Keep the supported locale identifiers `en_US`, `zh_Hans`, and `zh_Hant`;
  use `system` only as the setting that resolves to one of those locales.
- When adding a key, provide all three translations and keep English as the
  fallback source of truth.

## Required Verification

Run, as applicable:

- npm run format:check
- npm run lint
- npm run typecheck
- npm run check:vditor
- npm test
- npm run build
- npm run test:e2e

Use the smallest sufficient verification during iteration, but run
`npm run check:all` before merging a feature that affects both processes or
the renderer shell. Run release packaging separately with the appropriate
`npm run release:linux:*` command when packaging behavior changes.

If Electron E2E cannot start because the execution environment forbids
Chromium single-instance sockets, report it as an environment limitation.
Do not report the application tests as failed unless an assertion ran and failed.

GUI/Electron E2E tests may require execution outside the normal sandbox. A
launch failure before any assertion is an environment limitation; an
assertion failure is an application failure. Do not silently replace E2E with
unit tests.

## Branches and release workflow

- Develop feature and fix work on `dev`, `dev-<version number>` or `feat-<feat name>`, based on developer's preferences.
- Keep `master` release-oriented; merge completed work through a GitHub pull
  request rather than developing directly on `master`.
- Do not move an existing release tag to include a follow-up fix unless the
  release process explicitly calls for a new tag.
- Build metadata and the About page may resolve a version tag to its commit;
  preserve that relationship when preparing a release.

## Repository and artifact hygiene

- Keep generated `dist/`, `static/`, `release/`, coverage, Playwright reports,
  test results, and dependency directories out of Git.
- Do not commit local configuration, Chromium profiles, screenshots created
  only for debugging, or downloaded build tools.
- Update `README.md` and `README_CN.md` together when product-facing behavior,
  installation, or user-facing terminology changes.
- Update `CHANGELOG.md` for user-visible behavior changes; keep development
  planning and issue tracking in `docs/`.

## Working Method

- Inspect the current implementation before applying a plan.
- Treat development plans as living specifications, not mechanical checklists.
- Keep behavior changes separate from refactoring when possible.
- Complete and verify one bounded stage before beginning another.
- Do not silently expand the requested scope.
- Prefer `apply_patch` for source and documentation edits, and avoid
  destructive Git or filesystem commands unless explicitly requested.
- Before changing a Vditor-dependent behavior, inspect the current Vditor
  source and the adapter contract, then add a focused unit or E2E regression
  test where the behavior is observable.
