# Vditor-Electron Project Instructions

## Product Positioning

Vditor-Electron is a local-first desktop Markdown editor powered by Electron and Vditor. It edits ordinary Markdown files directly.

Do not expand it into a knowledge base, a cloud-sync service, an account-based service, or an application using a proprietary document format.

The product is a desktop host and experience layer for Vditor. Keep Markdown editing, rendering, and the three editing modes delegated to Vditor; keep desktop windows, files, workspaces, settings, localization, and platform behavior in the application layer.

The stable application identity is `com.github.studio-200a.vditor-electron`. Treat it as an immutable product and data-path contract: keep it identical in `package.json`, Electron `appId`, `src/main/app-paths.ts`, Linux desktop/AppStream metadata, release packaging, tests, and documentation. Do not replace it to satisfy a packaging or metadata validator. If a tool rejects the ID, adjust or replace that validation step while retaining the ID. Changing this identity requires an explicit product decision plus a documented configuration/data-directory migration, release/version strategy, and synchronized cross-platform updates.

## Architecture Boundaries

- Keep Vditor pinned to 3.11.3 unless a task explicitly authorizes an upgrade.
- Centralize all of Vditor's private DOM access in src/renderer/vditor-adapter.js.
- Do not introduce React, Vue, or another UI framework.
- Do not add Monaco, CodeMirror, or another competing editor engine to replace or overlay Vditor's editing modes without an explicit architecture decision.
- Preserve contextIsolation: true and nodeIntegration: false.
- Do not rebuild all Vditor instances for presentation-only settings.
- Keep Vditor's private DOM selectors, structural assumptions, and DOM workarounds in `src/renderer/vditor-adapter.js`. The rest of the renderer may consume adapter APIs, but must not query Vditor internals directly.
- Keep the bundled Vditor assets offline. Changes to the asset-copy process, CDN configuration, or the pinned Vditor version require updating the Vditor check and upgrade documentation.
- Preserve user changes and unrelated worktree modifications.

## Security and data boundaries

- Keep `contextIsolation: true`, `nodeIntegration: false`, and the preload API narrow; expose capabilities through explicit context-bridge methods.
- Treat Markdown files, image paths, and external links as untrusted input. Resolve local resources through the application protocol and use Electron's shell APIs for external navigation.
- Keep TOML configuration separate from Chromium user data using the platform paths implemented by `src/main/app-paths.ts`.
- Do not add telemetry, cloud synchronization, accounts, or background upload behavior without an explicit product decision.

## Architecture Map

`docs/01-CODE-STRUCTURE.md` is a repository architecture map intended for on-demand navigation.

Do **not** read this document from beginning to end by default.

When architectural context is needed:

1. First extract or inspect only its Markdown headings (`#`, `##`, `###`, etc.).
2. Identify the section or sections relevant to the current task.
3. Read only those relevant sections.
4. Use the referenced files, functions, modules, and data flows to locate the actual implementation.
5. Always verify the current source code before making changes.

Treat `01-CODE-STRUCTURE.md` as a **navigation map, not the source of truth**. It represents the repository at the commit recorded at the top of the document and may become partially stale as development continues.

Only read multiple sections when the task crosses architectural boundaries, such as renderer ↔ preload ↔ main-process IPC or UI ↔ settings ↔ persistence.

**Keep it updated**: The last thing to do before a dev/main branch merge and a new release is to update `docs/01-CODE-STRUCTURE.md` if necessary. Remind the developer to do so before publishing a new release, so that everything is well tracked.

## Technical Standards

### Cross-platform behavior

- Prefer Electron and Node.js APIs over shell commands, platform-specific executables, or browser assumptions when an application capability is needed.
- Keep runtime code shell-free. Do not invoke `rm`, `cp`, `mkdir`, `open`, `xdg-open`, PowerShell, or other operating-system commands to implement file, path, clipboard, dialog, or external-navigation behavior.
- Use `node:path` (`resolve`, `join`, `relative`, `dirname`, `basename`, and `sep`) for filesystem paths. Do not concatenate, split, or normalize local paths with hard-coded `/` or `\\` separators.
- Keep filesystem paths and URL paths distinct: use `URL` APIs for URLs and application-protocol paths; use `node:path` for local files. Normalize and validate an untrusted local path before checking containment or accessing it.
- Branch on `process.platform` only for real platform behavior, keep each branch small, and use Electron APIs where they provide the platform abstraction. Do not infer a platform from path shape, user-agent text, or display behavior.
- Put platform config/data locations behind `src/main/app-paths.ts`. Preserve the separation between TOML configuration and Chromium user data.
- Make platform-specific path behavior testable by accepting an explicit platform/environment/path API where practical; cover Windows, macOS, and Linux cases without relying on the host OS.

### Process and API boundaries

- Keep Node.js, Electron main-process APIs, filesystem access, dialogs, watchers, protocols, and OS integration in `src/main`. Renderer code must not import Node built-ins or assume direct filesystem access.
- Expose a capability through preload only when the renderer has a concrete product need. Add one explicit, narrow context-bridge method rather than a generic IPC wrapper or a broad object such as filesystem/shell access.
- Treat every IPC argument, renderer origin, file path, URL, and binary payload as untrusted at the main-process boundary. Validate runtime shapes, enum values, numeric bounds, and authorization scope before performing privileged work.
- Keep IPC channel names, request shapes, and result/error behavior aligned across main, preload, renderer, and tests. A change to one side requires reviewing the other sides in the same change.
- Use Electron `shell` APIs only after URL validation for external navigation; never navigate the application window to untrusted external content.

### Source-code and state discipline

- Keep TypeScript main-process code compatible with strict type checking. Do not use `any`, unchecked casts, or lint suppressions to bypass an unclear contract; narrow values at the boundary instead.
- Keep each state field owned by one domain. Do not reuse a persisted setting for unrelated runtime/session state, and do not mutate settings/session/tab state from multiple unrelated event paths without an explicit transition.
- Separate data that may be persisted from runtime handles such as DOM nodes, Vditor instances, `Range` objects, observers, timers, animation frames, and event-listener cleanup functions. Never serialize runtime handles.
- Any feature that registers listeners, observers, timers, animation frames, watchers, or subscriptions must define its cleanup path. Dispose resources on tab close, editor rebuild, workspace switch, modal close, and application shutdown as applicable.
- Prefer small, named helpers for a repeated or security-sensitive operation; keep one-off behavior local. Do not introduce an event bus, global utility layer, or framework solely to move code between files.
- Preserve user-visible behavior during refactors. Keep behavior changes and structural migrations separate when feasible, and do not combine unrelated formatting churn with either.

### Code consistency and agent conventions

- Code formatting follows the root `.prettierrc.json`; static analysis follows `eslint.config.mjs`; use repository scripts for verification. Do not override these rules with personal or agent preferences.
- Rules take precedence in this order: security and product boundaries, automated configuration, this document, then verified stable code in the same responsibility domain. Resolve conflicts in favor of the higher-priority rule; when uncertain, inspect the source and relevant tests rather than introducing another equivalent pattern.
- Within the same responsibility domain, follow verified stable conventions for naming, imports/exports, error handling, and lifecycle management. Do not introduce parallel equivalent patterns in that domain. When a migration plan defines a new pattern, follow it and migrate the old pattern progressively.
- Do not rewrite legacy code or change a file's language solely for style consistency. Preserve the current language boundary and follow the relevant versioned migration plan.
- When module location or data flow context is needed, read the relevant sections of `docs/01-CODE-STRUCTURE.md` and then verify against source. Follow the relevant development plan for versioned migrations. Configuration details and verification commands are defined by the active configuration files and `package.json` scripts.

### Naming, imports, and code organization

- Use lowercase kebab-case for files and directories, except project-standard root configuration files. Name a file for its primary responsibility, not its current caller.
- Use `PascalCase` for classes, interfaces, and type aliases that model a domain concept; use `camelCase` for functions, methods, variables, object properties, and parameters. Use `UPPER_SNAKE_CASE` only for true module-level constants such as limits, schema versions, and immutable defaults.
- Start boolean names with an affirmative predicate such as `is`, `has`, `can`, `should`, or `expected`. Name event callbacks and operations by their effect, such as `onChanged`, `persistWindowMaximized`, or `resolveRelativeMarkdownLink`; avoid vague names such as `handle`, `data`, `result`, or `utils` when a domain name is available.
- Model finite cross-boundary states with string-literal unions or discriminated result types. Do not use free-form strings when the receiver must branch on a known set of values.
- In TypeScript, use interfaces for object-shaped contracts and classes only when they own behavior or lifecycle. Prefer `unknown` at untrusted boundaries and narrow it at runtime; do not add `any`, type assertions, or lint suppressions merely to avoid defining a contract. Existing JavaScript and tests may use `any` only where their runtime boundary makes a precise type impractical.
- Order imports in contiguous groups: Electron/external packages, Node built-ins, then relative project modules. Keep the ordering already established in a touched file unless the whole import block is being meaningfully changed. New Node built-in imports use the `node:` prefix.
- Prefer named exports for reusable main-process services, types, and pure helpers. Keep renderer browser scripts in their existing IIFE/global attachment form unless an approved migration changes that boundary.
- Keep a one-off operation local to its caller. Extract a small named helper when behavior is repeated, security-sensitive, independently testable, or owns cleanup. Do not use line-count limits as a splitting rule: a cohesive transaction with error handling and cleanup may remain one function.
- Place state next to its owning domain and make transitions explicit. Do not use a persisted setting as incidental UI/session state, and do not serialize DOM nodes, Vditor instances, ranges, observers, timers, or cleanup callbacks.

### Comments and error handling

- Comments explain a non-obvious constraint, compatibility assumption, security boundary, platform behavior, or cleanup reason. They do not paraphrase the next statement, narrate edits, or preserve obsolete implementation history.
- Put a concise comment immediately beside the constrained code. For a dependency on a Vditor private contract, name the supported Vditor version or behavior and state why the workaround preserves user-visible behavior.
- Treat expected, user-recoverable domain outcomes as stable, typed results. Use a small string-literal error code with the data needed to recover or present the outcome; do not force renderer code to parse exception messages.
- Throw errors for violated programmer invariants and unexpected infrastructure failures. Create a custom error class only when a caller must distinguish that condition from other failures, as with an external document change. Preserve the original error or use `cause` when wrapping it.
- Never swallow an error silently. An intentionally non-fatal cleanup failure must be explicitly documented and logged when it is useful for diagnosis; cleanup must not replace the original failure.
- At IPC and persistence boundaries, validate and normalize untrusted input before work begins, and expose only safe result/error semantics to the renderer. Do not leak a raw filesystem path, stack trace, or Node error as a user-facing message.

### Renderer, DOM, and Vditor integration

- Renderer code may query application-owned DOM only. Use `textContent` or explicit DOM construction for untrusted content; do not interpolate file names, Markdown-derived values, paths, or external data into `innerHTML`.
- Keep renderer UI strings, labels, tooltips, empty states, errors, and menu entries localized through `src/renderer/locales.js`; add all three supported locales in the same change.
- Vditor private DOM selectors, mode-specific structural assumptions, Range workarounds, and non-public behavior belong exclusively in `src/renderer/vditor-adapter.js`. Renderer controllers call semantic adapter APIs and must not duplicate Vditor selectors or mutate Vditor internals.
- When an adapter feature depends on a non-public Vditor contract, document the assumption in a concise code comment, add a focused adapter test, and add its verification to the Vditor upgrade documentation when it is user-visible or safety-sensitive.
- Reuse Vditor's own input, serialization, selection, and undo paths where available. Do not implement an edit by round-tripping the whole document through `getValue()` and `setValue()` if that would discard selection, undo history, mode state, or editor-owned DOM state.

### Tests and observable behavior

- Add focused unit tests for pure path, state, parsing, validation, and adapter behavior. Use DOM tests for renderer interaction/lifecycle behavior and E2E tests for Electron, preload, protocol, Vditor, and native-window integration.
- Test behavior and contracts rather than source-string presence or private function ordering. Test both the normal path and the relevant failure, cleanup, permission, or boundary path.
- Do not replace an Electron E2E case with a unit test when the behavior depends on the real Electron/Vditor/protocol composition.
- Name test files `<subject>.test.ts` and group related observable behavior under `describe('<subject>', ...)`. Write `it(...)` descriptions as present-tense behavior, including the condition and outcome when that makes the contract clearer.
- Make filesystem and platform behavior testable through narrow injected dependencies or explicit platform/path inputs where practical. Restore spies and temporary resources in test cleanup; do not let a test depend on execution order or host-specific paths.
- When changing a Vditor private-DOM assumption, add or update a focused adapter test that detects structural drift. When changing a cross-process contract, cover the validation or authorization boundary at the appropriate unit or E2E layer.

## Localization

- Use the locale keys in `src/renderer/locales.js` for user-visible text, labels, titles, tooltips, dialogs, menus, and empty states.
- Keep the supported locale identifiers `en_US`, `zh_Hans`, and `zh_Hant`; use `system` only as the setting that resolves to one of those locales.
- When adding a key, provide all three translations and keep English as the fallback source of truth.

## Required Verification

Run, as applicable:

- npm run format:check
- npm run lint
- npm run typecheck
- npm run check:vditor
- npm test
- npm run build
- npm run test:e2e

Use the smallest sufficient verification during iteration, but run `npm run check:all` before merging a feature that affects both processes or the renderer shell. Run release packaging separately with the appropriate `npm run release:linux:*` command when packaging behavior changes.

If Electron E2E cannot start because the execution environment forbids Chromium single-instance sockets, report it as an environment limitation. Do not report the application tests as failed unless an assertion ran and failed.

GUI/Electron E2E tests may require execution outside the normal sandbox. A launch failure before any assertion is an environment limitation; an assertion failure is an application failure. Do not silently replace E2E with unit tests.

## Branches and release workflow

- Develop feature work and fix work on `dev`, `dev-<version number>`, or `feat-<feat name>` branches, based on the developer's preferences.
- Keep `main` release-oriented; merge completed work through a GitHub pull request rather than developing directly on `main`.
- Do not move an existing release tag to include a follow-up fix unless the release process explicitly calls for a new tag.

## Repository and artifact hygiene

- Keep generated `dist/`, `static/`, `release/`, coverage, Playwright reports, test results, and dependency directories out of Git.
- Do not commit local configuration, Chromium profiles, screenshots created only for debugging, or downloaded build tools.
- Update `README.md` and `README_CN.md` together when product-facing behavior, installation, or user-facing terminology changes.
- Update `CHANGELOG.md` for user-visible behavior changes; keep development planning and issue tracking in `docs/`.

## Working Method

- Inspect the current implementation before applying a plan.
- Treat development plans as living specifications, not mechanical checklists.
- Keep behavior changes separate from refactoring when possible.
- Complete and verify one bounded stage before beginning another.
- Do not silently expand the requested scope.
- Prefer `apply_patch` for source and documentation edits, and avoid destructive Git or filesystem commands unless explicitly requested.
- Before changing a Vditor-dependent behavior, inspect the current Vditor source and the adapter contract, then add a focused unit or E2E regression test where the behavior is observable.
