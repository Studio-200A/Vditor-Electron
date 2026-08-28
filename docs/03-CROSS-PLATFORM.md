# Cross-Platform Implementation and Verification

## 1. Purpose and scope

This document is the central record for Vditor-Electron cross-platform implementation boundaries and verification evidence. It covers Linux, Windows, and macOS behavior that can affect file editing, workspaces, watchers, paths, permissions, windows, menus, packaging, and system integration.

It is intentionally separate from the 0.2.0 execution tracker. The tracker records which batch owns a risk; this document records the platform rule, the test method, and the evidence.

The version-independent file-safety contract, including the remaining non-atomic compare-and-replace boundary for an existing target, is maintained in [`docs/05-FILE-SAFETY.md`](05-FILE-SAFETY.md). This document records only the platform-specific behavior and evidence needed to validate that contract.

The current development and validation platform is Linux. Cross-platform work is scheduled to begin after the 0.2.5 renderer refactor and after Windows/macOS test environments are available. Until then, Linux tests may prevent platform-agnostic regressions, but must not be reported as Windows or macOS validation.

## 2. Product and architecture boundaries

- Keep ordinary Markdown files as the source of truth. Do not introduce a platform-specific document format.
- Prefer Electron and Node.js APIs over shell commands or platform-specific executables.
- Keep filesystem, window, menu, dialog, watcher, clipboard, and external-navigation differences in main-process services or narrow bridge capabilities.
- Keep renderer behavior independent of path syntax and operating-system names wherever possible.
- Use `node:path` for native paths and URL APIs for application-protocol paths. Do not infer the platform from a path string.
- Keep Vditor pinned to 3.11.3 and keep its private DOM access inside `src/renderer/vditor-adapter.js`.

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
| Window chrome | Custom controls | Custom controls | Native traffic lights plus safe area | Real-window visual and interaction test |
| Menus | Renderer menu | Renderer menu | Renderer plus native menu | Verify menu parity and platform conventions |
| Data paths | XDG config/data paths | APPDATA/LOCALAPPDATA | Library/Application Support | Unit tests plus one installed/runtime smoke test per OS |

## 5. Current implementation status

### Implemented and Linux-tested

- Platform data/config/recovery paths are centralized in `src/main/app-paths.ts`.
- Workspace directory links that resolve through `realpath` are classified as inside or outside the workspace. Internal links use the target's workspace depth; outside and cyclic links remain visible but cannot expand.
- Workspace monitoring does not follow symlinks and uses the selected 7–12 directory depth.
- `.lnk` and Finder alias are intentionally treated as ordinary files. Supporting them requires a separate product and security decision.
- Safe document writes use a same-directory temporary file and replacement flow; failure paths preserve the original file.
- The 0.2.0 file-state flows cover external modification, deletion, reappearance, and unreadable/permission states.
- Directory rename, directory deletion, Save As watcher rebinding, descendant path updates, and invalid workspace-root reset are implemented and Linux-tested; Windows/macOS filesystem semantics remain unvalidated.

As of 2026-08-28, 0.2.0 development tracker batches 7 and 7.1 are closed for the Linux-local implementation and regression scope. The user-run Linux `npm run check:all` result covered 149/149 unit tests and 112/112 Electron Playwright tests, in addition to formatting, lint, typecheck, Vditor-version, and build checks. Batch 8 has separately passed its focused URL/navigation checks; its post-change full regression is still pending in the execution tracker. This is local regression evidence only; it does not close any Windows or macOS row below.

### Not yet platform-validated

- Windows/macOS watcher event ordering, path casing, permissions, and atomic replacement
- Windows junction behavior and macOS symlink/Finder alias behavior
- Native dialogs, menus, title bars, clipboard, packaging, signing, and installed-app data paths
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
