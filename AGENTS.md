# Vditor-Electron Project Instructions

## Product Positioning

Vditor-Electron is a local-first desktop Markdown editor powered by Electron and Vditor. It edits ordinary Markdown files directly.

Do not expand it into a knowledge base, a cloud-sync service, an account-based service, or an application using a proprietary document format.

The product is a desktop host and experience layer for Vditor. Keep Markdown editing, rendering, and the three editing modes delegated to Vditor; keep desktop windows, files, workspaces, settings, localization, and platform behavior in the application layer.

The stable application identity is `com.github.studio-200a.vditor-electron`. Treat it as an immutable product and data-path contract: keep it identical in `package.json`, Electron `appId`, `src/main/app-paths.ts`, Linux desktop/AppStream metadata, release packaging, tests, and documentation. Do not replace it to satisfy a packaging or metadata validator. If a tool rejects the ID, adjust or replace that validation step while retaining the ID. Changing this identity requires an explicit product decision plus a documented configuration/data-directory migration, release/version strategy, and synchronized cross-platform updates.

## Architecture Boundaries

- Keep Vditor pinned to 3.11.3 unless a task explicitly authorizes an upgrade.
- Do not introduce React, Vue, or another UI framework.
- Do not add Monaco, CodeMirror, or another competing editor engine to replace or overlay Vditor's editing modes without an explicit architecture decision.
- Do not rebuild all Vditor instances for presentation-only settings.
- Keep all of Vditor's private DOM selectors, structural assumptions, and DOM workarounds exclusively in `src/renderer/vditor-adapter.js`. The rest of the renderer must consume adapter APIs only, never query or mutate Vditor internals directly. When an adapter feature depends on a non-public Vditor contract, document the assumption in a concise code comment, add a focused adapter test, and add its verification to the Vditor upgrade documentation when it is user-visible or safety-sensitive.
- Keep the bundled Vditor assets offline. Changes to the asset-copy process, CDN configuration, or the pinned Vditor version require updating the Vditor check and upgrade documentation.
- Preserve user changes and unrelated worktree modifications.

## Security and data boundaries

- Keep `contextIsolation: true`, `nodeIntegration: false`, and the preload API narrow; expose capabilities through explicit context-bridge methods.
- Treat Markdown files, image paths, and external links as untrusted input. Resolve local resources through the application protocol and use Electron's shell APIs (only after URL validation) for external navigation; never navigate the application window to untrusted external content.
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

Treat `01-CODE-STRUCTURE.md` as a **navigation map, not the source of truth**. It represents the repository at the commit recorded at the top of the document and may become partially stale as development continues. Only read multiple sections when the task crosses architectural boundaries, such as renderer ↔ preload ↔ main-process IPC or UI ↔ settings ↔ persistence.

**Keep it updated**: The last thing to do before a dev/main branch merge and a new release is to update `docs/01-CODE-STRUCTURE.md` if necessary. Remind the developer to do so before publishing a new release, so that everything is well tracked.

## Issue and Technical Debt Tracking

`docs/00-ISSUES.md` is the single home for every long-term technical debt item, architecture risk, accumulated to-do, improvement backlog entry, and settled constraint that must not regress, alongside the temporary issues of the version currently in development.

- Read the relevant entries before planning work in a domain that already has a known open issue, such as file safety, Vditor private-DOM assumptions, the settings model, or an upcoming Vditor upgrade. Treat their findings and closing conditions as given; do not re-derive them or silently work around them.
- Record a newly discovered debt item, risk, or to-do in `docs/00-ISSUES.md` within the same change. Do not park it in a code comment, `CHANGELOG.md`, the architecture map, or a conversation summary.
- State the observable symptom, the owning files, why current platform or upstream capability cannot close it yet, and the concrete condition that would close it. An entry without a closing condition is a note, not a tracked issue.
- Keep `docs/01-CODE-STRUCTURE.md` free of debt, risk, and improvement lists; it describes only the current code structure and points to `docs/00-ISSUES.md` for the rest.
- Keep dated batch execution evidence, test totals, and manual-acceptance records in the version tracker under `docs/`, not in `docs/00-ISSUES.md`.
- Close a temporary version issue by recording its resolution in English in the corresponding `CHANGELOG.md` version section. Close a long-term item only when its stated closing condition is met with evidence, such as focused tests or real-platform verification; rewording the entry is not a closure.
- Delete a long-term entry once its stated closing condition is met with evidence; do not keep resolved entries around as stale clutter. User-visible outcomes live in `CHANGELOG.md`, and the implementation/verification history stays traceable through the version plan documents (archived under `ARCHIVED/`), so 00-ISSUES keeps only open items.

## Technical Standards

### Cross-platform behavior

- Prefer Electron and Node.js APIs over shell commands, platform-specific executables, or browser assumptions when an application capability is needed. Keep runtime code shell-free — do not invoke `rm`, `cp`, `mkdir`, `open`, `xdg-open`, PowerShell, or other OS commands to implement file, path, clipboard, dialog, or external-navigation behavior.
- Use `node:path` (`resolve`, `join`, `relative`, `dirname`, `basename`, `sep`) for filesystem paths. Do not concatenate, split, or normalize local paths with hard-coded `/` or `\\` separators. Keep filesystem paths and URL paths distinct: use `URL` APIs for URLs and application-protocol paths; use `node:path` for local files. Normalize and validate an untrusted local path before checking containment or accessing it.
- Branch on `process.platform` only for real platform behavior, keep each branch small, and use Electron APIs where they provide the platform abstraction. Do not infer a platform from path shape, user-agent text, or display behavior.
- Put platform config/data locations behind `src/main/app-paths.ts`. Preserve the separation between TOML configuration and Chromium user data.
- Make platform-specific path behavior testable by accepting an explicit platform/environment/path API where practical; cover Windows, macOS, and Linux cases without relying on the host OS.

### Process and API boundaries

- Keep Node.js, Electron main-process APIs, filesystem access, dialogs, watchers, protocols, and OS integration in `src/main`. Renderer code must not import Node built-ins or assume direct filesystem access.
- Expose a capability through preload only when the renderer has a concrete product need. Add one explicit, narrow context-bridge method rather than a generic IPC wrapper or a broad object such as filesystem/shell access.
- Treat every IPC argument, renderer origin, file path, URL, and binary payload as untrusted at the main-process boundary. Validate runtime shapes, enum values, numeric bounds, and authorization scope before performing privileged work.
- Keep IPC channel names, request shapes, and result/error behavior aligned across main, preload, renderer, and tests. A change to one side requires reviewing the other sides in the same change.

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
- When module location or data flow context is needed, read the relevant sections of `docs/01-CODE-STRUCTURE.md` and then verify against source. Follow the relevant development plan for versioned migrations.

### Naming and code organization

- Naming and formatting mechanics (casing, import ordering, etc.) are enforced by `.prettierrc.json` / `eslint.config.mjs` — do not restate or override them here.
- Name things for their effect and domain, not their mechanics: booleans start with `is`/`has`/`can`/`should`/`expected`; callbacks and operations name their effect (`onChanged`, `persistWindowMaximized`) rather than generic terms like `handle`, `data`, `result`, `utils`. Model finite cross-boundary states with string-literal unions or discriminated result types instead of free-form strings.
- In TypeScript, use interfaces for object-shaped contracts and classes only when they own behavior or lifecycle. Prefer `unknown` at untrusted boundaries and narrow it at runtime. Existing JavaScript and tests may use `any` only where their runtime boundary makes a precise type impractical.
- Prefer named exports for reusable main-process services, types, and pure helpers. Write new renderer modules as TypeScript with explicit imports, bundled by `scripts/build-renderer.js`; do not add new plain IIFE/global-attachment browser scripts. Keep the transitional globals (`window.__vditorDesktopPureFunctions`, `window.__vditorDesktopApplication`) and the remaining plain scripts (`app/app-composition.js`, `vditor-adapter.js`) in their current form until the approved composition migration replaces them. The typed `locale/` entry publishes `window.VditorDesktopLocales` through the generated `locales.js` bundle for the existing composition load order.
- Keep a one-off operation local to its caller. Extract a small named helper when behavior is repeated, security-sensitive, independently testable, or owns cleanup. Do not use line-count limits as a splitting rule: a cohesive transaction with error handling and cleanup may remain one function.

### Renderer composition layer

- Treat `src/renderer/app/app-composition.js` as a composition boundary: it may create the store and controllers, inject narrow dependencies, wire startup/dispose callbacks, and retain small, named cross-domain coordination callbacks.
- Do not start another systematic split of `app-composition.js` merely to make it thinner. Keep its existing responsibilities until a concrete change reveals a clear owner and a behavior-preserving extraction boundary.
- Do not add a new responsibility, domain, or product capability to `app-composition.js`. Implement new behavior that can live in a module in the owning renderer domain, even when that module does not yet exist; add only the narrow construction, dependency injection, and cross-domain wiring needed to connect it.
- Do not extract code solely to reduce the composition file's line count. Extract a controller when behavior owns domain state, runtime resources, a security boundary, or an independently testable transaction.
- Do not add direct Store writes, bridge subscriptions, timers, observers, event listeners, watcher ownership, or Vditor private-DOM access to the composition layer for new behavior. Put those responsibilities in the owning controller or adapter, with an explicit cleanup path where applicable.
- A composition callback must name the coordinated use case and remain narrow. If it accumulates state transitions, resource lifecycle, or reusable business rules, move the behavior to a focused controller with tests and an explicit cleanup path.

### Renderer module placement

- Put a new renderer module in the owning domain directory: `documents/` for document identity, save, watcher and recovery transitions; `editor/` for Vditor runtime and editor-owned UI lifecycle; `workspace/` for workspace and explorer behavior; `settings/` for preference/state persistence and settings UI; `ui/` for application-owned presentation; `export/` for export transactions; `resource-health/` for the isolated resource-health workflow; `core/` for shared controller, lifecycle, and DOM primitives; and `state/` for the AppStore, state types, and session snapshots.
- Keep cross-domain construction and narrow named orchestration in `app/app-composition.js`, which the `main.ts` entry starts through the `AppController` (`app/app-controller.ts`) lifecycle sequencing; do not create a catch-all renderer utility directory or return business state to the composition layer.
- Put renderer-wide runtime types and browser global declarations in `src/renderer/types/`, pure side-effect-free helpers in `src/renderer/utils/`, and serializable cross-process DTOs in `src/shared/contracts/`. A new Vditor private-DOM dependency belongs in `vditor-adapter.js` with its focused contract test.

### Comments and error handling

- Comments explain a non-obvious constraint, compatibility assumption, security boundary, platform behavior, or cleanup reason. They do not paraphrase the next statement, narrate edits, or preserve obsolete implementation history. Put a concise comment immediately beside the constrained code; for a dependency on a Vditor private contract, name the supported Vditor version or behavior and state why the workaround preserves user-visible behavior.
- Treat expected, user-recoverable domain outcomes as stable, typed results. Use a small string-literal error code with the data needed to recover or present the outcome; do not force renderer code to parse exception messages.
- Throw errors for violated programmer invariants and unexpected infrastructure failures. Create a custom error class only when a caller must distinguish that condition from other failures, as with an external document change. Preserve the original error or use `cause` when wrapping it.
- Never swallow an error silently. An intentionally non-fatal cleanup failure must be explicitly documented and logged when it is useful for diagnosis; cleanup must not replace the original failure.
- At IPC and persistence boundaries, validate and normalize untrusted input before work begins, and expose only safe result/error semantics to the renderer. Do not leak a raw filesystem path, stack trace, or Node error as a user-facing message.

### Renderer, DOM, and Vditor integration

- Renderer code may query application-owned DOM only. Use `textContent` or explicit DOM construction for untrusted content; do not interpolate file names, Markdown-derived values, paths, or external data into `innerHTML`.
- Keep renderer UI strings, labels, tooltips, empty states, errors, and menu entries localized through `src/renderer/locale/`; add all three supported locales in the same change.
- Reuse Vditor's own input, serialization, selection, and undo paths where available. Do not implement an edit by round-tripping the whole document through `getValue()` and `setValue()` if that would discard selection, undo history, mode state, or editor-owned DOM state.

### Tests and observable behavior

- Add focused unit tests for pure path, state, parsing, validation, and adapter behavior. Use DOM tests for renderer interaction/lifecycle behavior and E2E tests for Electron, preload, protocol, Vditor, and native-window integration.
- Test behavior and contracts rather than source-string presence or private function ordering. Test both the normal path and the relevant failure, cleanup, permission, or boundary path.
- Do not replace an Electron E2E case with a unit test when the behavior depends on the real Electron/Vditor/protocol composition.
- Name test files `<subject>.test.ts` and group related observable behavior under `describe('<subject>', ...)`. Write `it(...)` descriptions as present-tense behavior, including the condition and outcome when that makes the contract clearer.
- Make filesystem and platform behavior testable through narrow injected dependencies or explicit platform/path inputs where practical. Restore spies and temporary resources in test cleanup; do not let a test depend on execution order or host-specific paths.
- When changing a Vditor private-DOM assumption, add or update a focused adapter test that detects structural drift. When changing a cross-process contract, cover the validation or authorization boundary at the appropriate unit or E2E layer.

## Localization

- Use the locale keys in `src/renderer/locale/` for user-visible text, labels, titles, tooltips, dialogs, menus, and empty states.
- Keep the supported locale identifiers `en_US`, `zh_Hans`, and `zh_Hant`; use `system` only as the setting that resolves to one of those locales.
- When adding a key, provide all three translations and keep English as the fallback source of truth.

## Required Verification

Run, as applicable:

- npm run format:check
- npm run check:project
- npm run lint
- npm run typecheck
- npm run typecheck:renderer
- npm run check:vditor
- npm test
- npm run build
- npm run test:e2e

Use the smallest sufficient verification during iteration, but run `npm run check:all` before merging a feature that affects both processes or the renderer shell. Run release packaging separately with the appropriate `npm run release:linux:*` command when packaging behavior changes.

For Electron E2E that validates renderer changes, do not trust potentially stale generated output. Recreate the generated renderer output from a clean state before the relevant verification: remove only generated `dist/` and `static/` output (or use a repository-provided clean command when one exists), then run `npm run build`. Do not assume `npm run build:renderer` refreshes plain JavaScript or assets copied by other build stages. Partial builds are acceptable during tight iteration only when the changed files are known to be covered by that build step; use a clean full build before treating E2E results as final evidence.

If Electron E2E cannot start because the execution environment forbids Chromium single-instance sockets, report it as an environment limitation. Do not report the application tests as failed unless an assertion ran and failed. A launch failure before any assertion is an environment limitation; an assertion failure is an application failure. Do not silently replace E2E with unit tests.

## Branches and release workflow

- Develop feature work and fix work on `dev`, `dev-<version number>`, or `feat-<feat name>` branches, based on the developer's preferences.
- Keep `main` release-oriented; merge completed work through a GitHub pull request rather than developing directly on `main`.
- Do not move an existing release tag to include a follow-up fix unless the release process explicitly calls for a new tag.

## Repository and artifact hygiene

- Keep generated `dist/`, `static/`, `release/`, coverage, Playwright reports, test results, and dependency directories out of Git.
- Do not commit local configuration, Chromium profiles, screenshots created only for debugging, or downloaded build tools.
- Update `README.md` and `README_CN.md` together when product-facing behavior, installation, or user-facing terminology changes.
- Update `CHANGELOG.md` for user-visible behavior changes; keep development planning in `docs/` and all issue, technical-debt, and to-do tracking in `docs/00-ISSUES.md`.

## Working Method

- Inspect the current implementation before applying a plan. Treat development plans as living specifications, not mechanical checklists.
- Keep behavior changes separate from refactoring when possible. Complete and verify one bounded stage before beginning another, and do not silently expand the requested scope.
- Prefer `apply_patch` for source and documentation edits, and avoid destructive Git or filesystem commands unless explicitly requested.
- Before changing a Vditor-dependent behavior, inspect the current Vditor source and the adapter contract, then add a focused unit or E2E regression test where the behavior is observable.

### Agent execution discipline

These rules preserve rigor while preventing unnecessary exploration. They do not reduce required verification, architecture checks, or safety boundaries.

- When a task provides a handoff, tracker, issue investigation, or prior reproduction evidence, treat its verified findings, stated scope, and acceptance criteria as the working starting point. Re-check them only when the current source, a focused experiment, or a failing test provides contradictory evidence; do not re-derive settled findings from scratch.
- Prefer an evidence loop of **hypothesis → smallest useful inspection or experiment → result → next action**. If the same uncertainty has been reconsidered more than once without new evidence, stop extending the reasoning chain and run the lowest-cost source inspection, focused test, or minimal probe that can resolve it.
- After reading the minimum necessary context, move promptly to the first falsifiable artifact: usually a focused failing regression test, a minimal implementation patch, or a direct runtime reproduction. Do not delay action merely to exhaust every theoretical edge case before obtaining feedback from the real code or tests.
- Keep exploratory scope separate from delivery scope. If an adjacent issue, stronger behavior guarantee, or unrelated edge case is discovered, record it in the appropriate issue/tracker and continue the requested task unless it blocks the stated acceptance criteria or an existing test proves a regression.
- Do not silently strengthen the definition of done. Tests may add representative boundary coverage, but they must remain anchored to the requested behavior, the handoff, and existing project contracts rather than inventing new product requirements.
- Once a focused regression test or runtime reproduction validates the core fix, do not reopen the settled design without contradictory evidence. Continue with the explicitly required boundary tests, broader verification, documentation, and cleanup.
- Use temporary instrumentation and ad-hoc probes sparingly. After two consecutive probe/debug cycles that do not materially narrow the problem, re-check the reproduction, build freshness, test fidelity, and scope assumptions before adding more instrumentation.
- Use automated verification as the primary quality gate. Efficiency means reducing redundant reasoning and duplicate investigation, not skipping tests, weakening guards, bypassing architecture boundaries, or reducing required coverage.
- At the end of each bounded stage, briefly restate the confirmed facts, changed files, passing/failing evidence, and next stage before continuing. This checkpoint should replace stale hypotheses rather than accumulate them indefinitely in the active reasoning context.
