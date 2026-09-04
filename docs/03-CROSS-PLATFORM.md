# Cross-Platform Implementation and Verification

## 1. Purpose and scope

This document is the central record for Vditor-Electron cross-platform implementation boundaries and verification evidence. It covers Linux, Windows, and macOS behavior that can affect file editing, workspaces, watchers, paths, permissions, windows, menus, packaging, and system integration.

It is intentionally separate from the 0.2.0 execution tracker. The tracker records which batch owns a risk; this document records the platform rule, the test method, and the evidence.

The version-independent file-safety contract, including the remaining non-atomic compare-and-replace boundary for an existing target, is maintained in [`docs/05-FILE-SAFETY.md`](05-FILE-SAFETY.md). This document records only the platform-specific behavior and evidence needed to validate that contract.

The current development and validation platform is Linux. Cross-platform work is scheduled to begin after the 0.2.5 renderer refactor and after Windows/macOS test environments are available. Until then, Linux tests may prevent platform-agnostic regressions, but must not be reported as Windows or macOS validation.

Linux full-suite evidence for the in-progress 0.2.5 renderer review is retained in [`docs/15-0.2.5-EXECUTION-TRACKER.md`](15-0.2.5-EXECUTION-TRACKER.md). A Linux retry after a resource-sensitive Electron E2E result is still Linux-only evidence and does not satisfy any Windows or macOS row.

## 2. Product and architecture boundaries

- Keep ordinary Markdown files as the source of truth. Do not introduce a platform-specific document format.
- Prefer Electron and Node.js APIs over shell commands or platform-specific executables.
- Keep filesystem, window, menu, dialog, watcher, clipboard, and external-navigation differences in main-process services or narrow bridge capabilities.
- Keep renderer behavior independent of path syntax and operating-system names wherever possible.
- Use `node:path` for native paths and URL APIs for application-protocol paths. Do not infer the platform from a path string.
- Keep Vditor pinned to 3.11.3 and keep its private DOM access inside `src/renderer/vditor-adapter.js`.
- The project pins Electron 44.1.0. Electron 44 requires macOS 13 or later and no longer ships prebuilt Windows 32-bit or Linux ARMv7 runtimes; the repository's Linux release script targets x86_64.

## 3. What Linux can and cannot prove

### 3.1 Suitable for Linux unit or integration tests

Linux can validate platform-independent algorithms and POSIX-like behavior, including:

- `path.posix` and path normalization rules using synthetic `/Users/user/...` inputs
- Windows path parsing through `path.win32`, including drive letters and backslashes
- containment checks, relative paths, directory-depth calculations, and symlink cycle detection
- ordinary symlink and `realpath` behavior
- UTF-8, BOM, line endings, safe same-directory replacement, and failure cleanup
- ordinary permission failures, missing paths, renames, deletes, and watcher cleanup
- injected platform capabilities and fake bridge results
- localization, UI state, and renderer behavior that does not depend on native OS integration

Using `/Users/user` instead of `/home/user` only tests a path-shaped input. It does not emulate macOS filesystem or system behavior.

### 3.2 Requires a real platform

The following must be verified on the target operating system and must not be marked complete from Linux-only evidence:

- actual default filesystem case behavior and Unicode filename behavior
- filesystem ACLs, extended attributes, file flags, ownership, and permission errors
- watcher event source, timing, coalescing, rename behavior, and recovery after a directory move
- atomic replacement of open, locked, read-only, or externally modified files
- Windows junctions, Windows `.lnk` shortcuts, and macOS Finder aliases
- native open/save dialogs, recycle-bin behavior, clipboard integration, and external navigation
- macOS traffic-light title-bar safe areas and native menus
- Windows and Linux custom window controls, high-DPI behavior, and packaging integration
- installer, portable package, AppImage, signing, quarantine, and launch behavior

Node's `path` implementation varies with the host platform, and some `fs` operations are explicitly platform-specific. A path string cannot change those runtime semantics. macOS APFS is case-insensitive by default but can be configured case-sensitive, so both the actual volume and the test result must be recorded.

## 4. Platform behavior matrix

| Area | Linux | Windows | macOS | Verification requirement |
| --- | --- | --- | --- | --- |
| Native path | POSIX path, `/` | Drive/UNC paths, `\\` and `/` inputs | POSIX path, `/` | Unit-test path algorithms; run native path smoke tests on each OS |
| Case behavior | Usually case-sensitive | Usually case-insensitive | APFS usually case-insensitive, but configurable | Real filesystem test with case-collision fixtures |
| Directory links | symlink | symlink and junction | symlink; Finder alias is a separate format | Test real link types on target OS |
| Shortcut files | ordinary files | `.lnk` currently ordinary files | Finder alias currently ordinary files | Keep current limitation until separately designed |
| Directory watcher | Linux backend and event timing | Windows backend and event timing | FSEvents behavior and coalescing | Create/change/rename/delete/reappear tests on each OS |
| Permissions | POSIX mode/ACL behavior | Windows permission model and sharing/lock rules | POSIX mode plus ACL and filesystem metadata | Test readable, writable, locked, and unavailable states on each OS |
| Safe replacement | Linux rename and open-file semantics | Windows replacement and sharing semantics | macOS rename and open-file semantics | Test manual and automatic save with open/locked targets |
| Window chrome | Custom controls | Custom controls | Native traffic lights plus safe area | Real-window visual and interaction test; on macOS, also verify Dock activation creates a fresh close-confirmation cycle |
| Menus | Renderer menu | Renderer menu | Renderer plus native menu | Verify menu parity and platform conventions |
| Data paths | XDG config/data paths | APPDATA/LOCALAPPDATA | Library/Application Support | Unit tests plus one installed/runtime smoke test per OS |

## 5. Current implementation status

### Implemented and Linux-tested

- Platform data/config/recovery paths are centralized in `src/main/app-paths.ts`; every platform uses the resolved configuration directory for both preference-only `config.toml` and versioned `state.json`.
- Workspace directory links that resolve through `realpath` are classified as inside or outside the workspace. Internal links use the target's workspace depth; outside and cyclic links remain visible but cannot expand.
- Workspace monitoring does not follow symlinks and uses the selected 7–12 directory depth.
- `.lnk` and Finder alias are intentionally treated as ordinary files. Supporting them requires a separate product and security decision.
- Safe document writes use a same-directory temporary file and replacement flow; failure paths preserve the original file.
- The 0.2.0 file-state flows cover external modification, deletion, reappearance, and unreadable/permission states.
- Directory rename, directory deletion, Save As watcher rebinding, descendant path updates, and invalid workspace-root reset are implemented and Linux-tested; Windows/macOS filesystem semantics remain unvalidated.
- Batch 12 scopes a renderer-approved window close to its originating `BrowserWindow`; Linux state and focused Electron close-flow tests pass, while the macOS Dock activation lifecycle remains unvalidated in section 13.

As of 2026-08-28, 0.2.0 development tracker batches 7, 7.1, and 8 are closed for the Linux-local implementation and regression scope. The user-run Linux `npm run check:all` passed its required static and Electron checks; the dated evidence is retained in the relevant Tracker records. Batch 8's dangerous-protocol and normal external-link manual checks also passed. This is local regression evidence only; it does not close any Windows or macOS row below.

Batch 10 has since completed its Linux-local implementation, focused automation, user manual validation, and user-run full-check pass. P12 subsequently added the window-scoped close-confirmation test and also has a passing Linux full-check record. P15 now pins Electron 44.1.0, updates the asynchronous clipboard boundary, and has a user-run passing Linux full-check record. The dated totals, exact reruns, and affected test scope belong to their Tracker records rather than this platform boundary document. Windows drive/UNC and junction verification remains explicitly deferred to sections 12.1–12.3, and macOS remains a separate native-runtime task; Electron 44's macOS 13 minimum must be used for that validation.

### Not yet platform-validated

- Windows/macOS watcher event ordering, path casing, permissions, and atomic replacement
- Windows junction behavior and macOS symlink/Finder alias behavior
- Native dialogs, menus, title bars, clipboard, packaging, signing, and installed-app data paths
- macOS Dock activation after the last window closes, including a fresh unsaved-document close confirmation in the replacement window
- Filesystem-specific Unicode normalization and case-collision behavior

The current batch and release status remains in [`docs/13-0.2.0-EXECUTION-TRACKER.md`](13-0.2.0-EXECUTION-TRACKER.md). Do not duplicate detailed platform evidence there.

## 6. Test strategy

### 6.1 Linux preflight

Before real platform work begins, keep the following coverage green on Linux:

- pure path tests using both `path.posix` and `path.win32` inputs
- injected platform/environment tests for `app-paths.ts`
- FileManager tests for missing paths, permissions, safe replacement, symlinks, containment, and depth
- FileWatchService tests for cleanup, stale events, depth, symlink non-following, and event deduplication
- renderer shell and localization tests for platform-independent UI behavior
- Electron E2E for ordinary file editing, workspace depth, directory links, recovery, conflicts, and menus

### 6.2 Per-platform filesystem scenarios

Run the following with a fresh test workspace and record the OS version, filesystem type, Electron/Node versions, and result:

1. Open a workspace containing ordinary files and nested directories.
2. Create and open a Markdown file, then save it manually and with autosave.
3. Modify the file from another application and verify reload or conflict behavior.
4. Delete the file, edit during the persistent unavailable state, restore it, and verify the explicit resolution flow.
5. Remove and recreate a directory link; verify internal, external, and cyclic link handling.
6. Rename and replace files while they are open in Vditor and in another application.
7. Exercise read-only, permission-denied, locked, missing, and externally replaced targets.
8. Use filenames differing only by case and filenames containing non-ASCII/normalization-sensitive characters.
9. Close and reopen the app with workspace restoration enabled; verify paths and watchers.

### 6.3 Platform UI and packaging scenarios

- Open/save dialogs return native paths that can be reopened and saved.
- Clipboard copy and paste work through the native system clipboard.
- External links use the platform handler and reject unsupported schemes.
- Window controls, title-bar drag regions, menus, fullscreen, high-DPI scaling, and keyboard modifiers follow platform conventions.
- A packaged build starts with clean user data, stores config/data in the expected location, and can edit, save, recover, and export.

## 7. Test fixtures and evidence format

Each platform test run should record:

- OS name and exact version
- filesystem type and whether the volume is case-sensitive
- Electron, Node.js, and Vditor versions
- workspace path and link types used
- command or manual steps
- expected result and observed result
- relevant console output, screenshots, and package identifier
- whether the result is a product failure, an environment limitation, or an intentional limitation

Linux synthetic paths such as `/Users/user` belong in unit fixtures only. They must not be presented as macOS evidence.

## 8. Open decisions and limitations

- `.lnk` and Finder alias support is deferred. If enabled later, define target resolution, authorization, missing-target behavior, cycle handling, icon/tooltip/accessibility text, and real-platform tests before implementation.
- Case-insensitive behavior must not be assumed globally because macOS can use a case-sensitive APFS volume and Linux can also use different filesystem types.
- Cross-platform changes should begin only when real Windows and macOS environments are available. Until then, keep platform-neutral abstractions testable without adding speculative workarounds.

## 9. 0.2.0 batch 7 deferred platform validation

### 9.1 Ownership and start condition

Batch 7 keeps ownership of platform-neutral correctness fixes in [`docs/13-0.2.0-EXECUTION-TRACKER.md`](13-0.2.0-EXECUTION-TRACKER.md): save/recovery state closure, canonical file identity contracts, directory-rename transaction convergence, and their Linux regression coverage. That local scope is complete as of 2026-08-27. This section owns only the native-platform evidence that cannot be produced from the current Linux development environment; no Windows/macOS row is closed yet.

The related long-term invariants and the exact remaining TOCTOU limitation are defined in [`docs/05-FILE-SAFETY.md` §7](05-FILE-SAFETY.md#7-已知原子性边界已有目标的-toctou). A platform result here updates that contract's evidence; it does not replace the contract with a version-specific checkbox.

Start this section after the 0.2.5 renderer refactor has a stable branch and real Windows and macOS test environments are available. A Linux path-shaped fixture, injected platform value, or successful Linux E2E is not evidence for a Windows or macOS row.

### 9.2 Deferred verification matrix

| Area | Windows evidence required | macOS evidence required | Expected safe result |
| --- | --- | --- | --- |
| File identity and casing | Same file through case variants, symlink/junction alias, deleted path, and Save As destination | Same matrix on both the tested APFS volume type and recorded case behavior | One open-tab identity per physical file; no unintended tab merge or watcher release |
| Safe write and conflict | Manual/autosave against open, read-only, locked, and externally replaced files | Manual/autosave against read-only, locked, and externally replaced files | Baseline mismatch never replaces disk; lock/permission errors preserve both versions |
| Watcher reconciliation | Modify during watch suspend/rebind; directory rename; delete/reappear; rapid consecutive writes | The same scenarios under FSEvents coalescing and directory moves | Latest disk fact wins; no stale reload, missed conflict, or orphaned watcher |
| Directory rename | Existing destination, case-only rename, busy descendant, and failure after filesystem rename | Existing destination, case-only rename where applicable, busy descendant, and recovery after move | No destination overwrite; all open descendants converge on one path/watch state |
| Native dialogs and session recovery | Open/Save As native paths, restart with recovery and restored tabs | Open/Save As native paths, restart with recovery and restored tabs | Dialog paths resolve to the same canonical identity; recovery does not duplicate a session tab |

### 9.3 Evidence and closure rule

For every matrix row, record the evidence format from section 7, including filesystem case behavior and the exact Electron/Node versions. A platform failure reopens the linked Tracker risk with a concise reproduction; a passing native run closes only that platform row. Completing Linux batch work must not imply Windows/macOS validation, and later platform validation must not rewrite the 0.2.0 batch's Linux verification result. The current status is therefore: Linux-local batch 7 closure recorded, all native Windows/macOS rows deferred.

## 10. 0.2.0 batch 10 Windows preflight observation

This is a read-only Windows observation recorded before batch 10 starts. It is a reproduction clue for the Linux implementation phase, not Windows platform validation and not a reason to begin the deferred cross-platform work early.

On 2026-08-29, the current renderer URL construction and protocol parsing were evaluated with the representative document directory `C:\\Users\\test\\Documents\\project` and relative image `assets/pixel.png`. The current `localResourceBase()` logic produces `local-file://rootC%3A%5CUsers%5Ctest%5CDocuments%5Cproject/`: the drive path is parsed as the URL host, while resolving the relative image leaves the pathname as `/assets/pixel.png`. The current `local-file` protocol handler decodes and passes that pathname to `path.resolve()`, which on this Windows workspace resolves it to `D:\\assets\\pixel.png`, rather than the document asset path.

Batch 10 must therefore define and unit-test a platform-neutral conversion contract before it implements authorization:

- A local-resource URL must use an explicit, fixed authority and a pathname that represents the complete encoded native path; an authority must never be formed by concatenating a path after `local-file://`.
- The URL-to-native-path conversion must reject unexpected authority values and must map Windows drive paths, POSIX paths, encoded separators, malformed percent encoding, `..`, and backslash confusion deliberately before `path.resolve()`, `realpath()`, or containment checks.
- Unit tests must exercise `path.win32` drive-letter and UNC inputs without requiring Windows, while native Windows verification later confirms actual filesystem and junction semantics.
- Resource E2E must cover a workspace image, an out-of-workspace document image, and a pasted image on Windows after the Linux batch implementation is stable.

The current checkout has no installed Vitest or Playwright dependencies, so the existing resource unit and Electron E2E suites could not be run during this observation. That is an environment limitation, not an automated test result.

## 11. 0.2.0 batch 10 Linux implementation checkpoint

Batch 10 was implemented on the Linux `dev-0.2.0` checkout on 2026-08-31. The implementation uses `local-file://root/<encoded-path>` with a fixed authority. POSIX absolute paths retain the leading slash in the pathname, Windows drive and UNC conversion are exercised through `path.win32`, and the old malformed `local-file://rootC%3A...` shape is rejected before any filesystem access.

The renderer synchronizes the current workspace and every open document parent directory through the narrow `file:setResourceRoots` bridge. Opening, closing, Save As, directory rename, recovery restoration, and workspace changes refresh the root set. The main process rejects malformed URL paths, applies lexical and canonical path boundaries, blocks configured config/Chromium/recovery roots, rejects symlink/junction-equivalent canonical escapes, and returns the same 404/plain-text/`nosniff`/`no-store` response for missing, unauthorized, unsupported, and SVG resources. Only the currently used raster image types receive an allowlisted MIME response. Internal diagnostics retain only a rejection category.

Focused Linux evidence at this checkpoint:

- `npm run typecheck`, `npm run lint`, and the focused Vitest selection: 41/41 tests passed, including POSIX/Windows URL and boundary policy cases, private roots, canonical escape, stale root revocation, MIME allowlist, and bounded IPC roots.
- After `npm run build`, focused Electron Playwright coverage passed 9/9: malformed high-risk IPC arguments, authorized/unauthorized local resources and response headers, root revocation after closing an outside document, restored relative images, raw HTML images, HTTPS images, uploaded/pasted images, and directory-rename resource rebinding.
- The user-run 2026-08-31 full check passed formatting, lint, typecheck, Vditor-version, build, and 181/181 unit tests. Its 126 Electron cases first produced a single mode-shortcut timing failure (125/126); the exact failed case then passed 1/1. No Windows or macOS runtime result is claimed here; Windows native filesystem, junction, casing, dialog, and installed-build behavior remain pending.

## 12. 0.2.0 batch 10 deferred Windows resource validation

The batch 10 Linux implementation and `path.win32` unit tests do not prove real Windows URL loading, filesystem behavior, or junction resolution. Run this section only on a native Windows installation after the current batch has a stable build. It is intentionally deferred rather than inferred from Linux results.

### 12.1 Drive and UNC resource URLs

Copy the batch 10 manual fixture to a local Windows path, then open `workspace/README.md` and the separate `outside-document/outside.md`. Confirm that each relative image displays, including after changing editor mode, and that closing the outside document makes its previously captured `local-file:` image URL return the neutral 404 response.

For a drive path, `data-local-resource-base` must retain the fixed `root` authority and encode the drive letter in the pathname, for example `local-file://root/C%3A/Users/<user>/Downloads/...`; it must never use a drive path as the URL authority. If an accessible UNC share is in scope, repeat the same document/image and close-revocation checks from `\\server\\share\\...`, recording the share, authentication context, and any policy restriction. A malformed legacy shape such as `local-file://rootC%3A...` must fail without reading a disk resource.

### 12.2 Junction canonical escape

Within the fixture workspace, create a directory junction that points to `outside-document`, then open a Markdown file whose image points through the junction. The image must not display; a direct fetch of its `local-file:` URL must return the same 404/plain-text/`nosniff`/`no-store` result as a missing resource. Delete the junction itself after the test, without deleting its target.

### 12.3 Windows pathname edge cases

Use document and asset names containing spaces, Chinese characters, `#`, and `%`; their legitimate relative images must display. A `..` reference outside the authorized root must not display. Record whether the tested volume is case-sensitive and retain the exact Windows, filesystem, Electron, Node, Vditor, and application commit versions with the result.

### 12.4 Closure rule

Each row above requires a real Windows result and its supporting screenshot or DevTools response evidence. A passing Linux E2E or `path.win32` unit test remains supporting evidence only; it does not close the Windows validation row. macOS resource behavior remains a separate native validation task.

## 13. 0.2.0 batch 12 deferred macOS window lifecycle validation

The batch 12 implementation keeps close confirmation associated with the exact `BrowserWindow` that received the renderer's explicit confirmation. Its unit test proves a replacement window cannot inherit that state, and the passing Linux full-check record includes the existing close-dialog IPC flow; exact results are retained in the batch 12 Tracker record. Neither can prove macOS behavior after the final window closes while the application remains active. The user has explicitly deferred this native test until a macOS environment is available.

Run this only on a native macOS installation after building the current branch:

1. Open a new untitled document, enter text without saving, close the window, and select **Don't Save**.
2. Click the application icon in the Dock to trigger `activate` and create a replacement window.
3. Open another new untitled document, enter text without saving, and close that replacement window.

The second close must display the unsaved-changes confirmation. Record the macOS version, Electron and Node versions, application commit, whether the original window disappeared before Dock activation, the final result, and a screenshot or screen recording. A missing confirmation is a batch 12 product failure; a passing native result closes only this macOS lifecycle row and updates the corresponding Tracker hand-test record.
