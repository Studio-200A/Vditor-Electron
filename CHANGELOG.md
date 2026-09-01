# Changelog

## 0.2.0 - Under-the-Hood Robustness Improvement

### New Features

#### Themes and symbolic icons

- **feat(themes):** Added Monokai Pro Light, Claude Light and Claude Dark application themes based on official public UI colors. Light and dark application themes are selected independently. They change application chrome only; Vditor continues to own editor typography, content themes, and code-block highlighting.
- **feat(theme mode):** Replaced the status-bar light/dark switch and Appearance-page system-theme checkbox with an icon-only three-way picker for fixed light, fixed dark, and follow-system modes. The resident icon shows the selected mode while the light/dark theme choices remain independently configurable.
- **feat(symbolic icons):** Replaced the supplied desktop chrome, explorer refresh, theme-mode, settings, settings-navigation, file-tree, and find-and-replace icons with the corresponding Lucide assets, including `file`, `folder`, `folder-symlink`, `replace`, and `replace-all`, while keeping existing UI identifiers and accessible labels stable. The selected SVGs are now sourced from the `lucide-static` build dependency; application logos and notification artwork remain project-owned assets.

#### Workspace and file operations

- **feat(workspace links):** The explorer now distinguishes real-path-resolvable directory links with an italic, underlined name and the Lucide `folder-symlink` icon. Links into the workspace follow the workspace depth limit; external and cyclic targets remain visible but cannot be expanded.
- **feat(workspace):** Added a persisted 7–12 workspace directory read-depth control (default 7). The explorer, restored folder expansion, and workspace monitoring share the same boundary, and the explorer explains when a deeper directory is intentionally not read.

#### Recovery and unavailable files

- **feat(recovery):** After an unexpected exit, unsaved documents now open directly with a persistent warning banner. The banner clearly distinguishes an unchanged original file from a changed or unavailable one, and only allows direct saving when it is safe; other recovery states can be saved elsewhere or discarded.
- **feat(external file state):** Open documents now distinguish external deletion, reappearance, and unreadable/permission states. Autosave pauses while a target is unavailable, and the editor keeps its in-memory content until the user chooses an explicit resolution.
- **feat(recreate backup):** Recreating an unavailable file copies the content captured before the unavailable state to the system clipboard and shows a five-second localized confirmation notice. The clipboard backup is not contaminated by edits made while the persistent notice is visible.

### Security Improvements

- **fix(navigation):** Unified URL validation and navigation decisions for `will-navigate`, `window.open`, and external-link handling; only `http:`, `https:`, and `mailto:` leave through the system handler, untrusted `app:` pages and bundled-asset navigations are blocked, and unsupported active schemes in rendered document links cannot execute in the renderer.
- **fix(IPC security):** Restricted privileged renderer IPC to the trusted top-level application page and validated high-risk paths, names, enums, sizes, settings, and binary payloads before side effects; malformed or untrusted requests now fail with stable, localized errors, and invalid persisted settings fall back safely per field.
- **fix(local resources):** Restricted `local-file://` previews to the active workspace and open-document directories, validated POSIX/Windows URL paths through canonical boundaries, blocked private and symlink-escaped paths, and limited responses to allowlisted raster images with accurate MIME headers; unsupported active content and SVG return a neutral 404. Save As now immediately rebinds preview authorization to the destination document directory and revokes the old root; it deliberately does not copy an existing `assets/` directory.
- **fix(renderer security):** Removed broad `unsafe-eval` and script `unsafe-inline` CSP permissions. Vditor's pinned MathJax loader is allowed through one exact script hash, while Markdown HTML filtering remains on by default. The Editor > Security card now explains the trade-off in all supported languages and requires confirmation before trusted raw HTML filtering can be disabled.
- **feat(controlled SVG rendering):** Added an off-by-default, localized SVG rendering setting for both local and HTTP(S) images. SVG URL and MIME responses are blocked until the user confirms the risk warning; revoking permission invalidates cached image responses without rebuilding Vditor or changing document sources.

### Bug Fixes

#### Workbench, toolbar, and menus

- **fix(settings updates):** Appearance, typography, zoom, scrollbar, toolbar and sidebar layout, and other application-only settings now update open documents without recreating Vditor, preserving the current undo history. Options that Vditor 3.11.3 can only apply at initialization still rebuild while retaining the active mode and scroll position.
- **fix(macOS window close):** Scoped an approved unsaved-changes close to its originating application window, so a window recreated from the Dock must ask again before discarding unsaved content.
- **fix(main menu theming):** Windows/Linux custom main-menu triggers and popups now use each theme's sidebar surface, so Claude Light and Monokai Pro Light retain their warm application-chrome tone instead of appearing white.
- **fix(sidebar tooltips):** Replaced browser-native sidebar tooltips with the shared application tooltip used by document links, so workspace, file-tree, link-directory, refresh, and outline controls now follow the active theme consistently.
- **fix(persistent notices):** Unified recovery and external-conflict banners around the persistent warning style, including the warning SVG, two-row narrow-layout behavior, larger 15px copy and action text, draggable overwrite confirmation, and readable red-and-white danger actions across light, dark, and Monokai themes.
- **fix(toolbar layout):** Stabilized the Files/Outline tab boundary when the shared toolbar is hidden or wraps; the sidebar tabs, toolbar, and loading skeleton now own their bottom border and shadow consistently across all six application themes.
- **fix(context menu):** Disabled Paste and Paste as Plain Text when the system clipboard has no content to insert.
- **fix(explorer context menu):** Moved New File and New Folder from file and directory item menus to blank explorer space, and now create collision-free `Untitled x.md` files and `Untitled x` folders automatically with independent number sequences.
- **fix(export resources):** HTML/PDF export now freezes its content before the save dialog, normalizes internal sources across `src`, `href`, `poster`, and `srcset`, and keeps HTML portable while embedding local PDF images. The one-shot PDF window has no business preload, keeps isolation and sandboxing enabled, and denies navigation and popups.
- **fix(open dialogs):** File and folder open dialogs now share the last confirmed selection directory.
- **fix(accessibility):** Use the active theme accent for keyboard-visible focus rings across application controls.
- **fix(settings theming):** Align the settings titlebar, navigation, footer, and edge with the active theme's sidebar surface while keeping settings content on the editor surface across all six application themes.
- **fix(settings chrome):** Removed the short header/footer divider segments at the settings dialog's right-edge strip so that the sidebar-surface chrome reads as one continuous area.
- **fix(light theme borders):** Reduced Claude Light and Monokai Pro Light structural-border contrast to match Classic's low-emphasis separators while preserving each theme's warm color temperature.
- **fix(asset layout):** Organized application icons, symbolic UI icons, and notification icons under dedicated renderer asset directories; the offline asset build and Linux release script now follow the same paths.

#### Editor interaction

- **fix(table scrolling):** Kept WYSIWYG and Instant Rendering table cells horizontally positioned while Vditor rebuilds them after multi-character input or paste. When the caret would otherwise leave the visible part of a long table, Desktop now scrolls only far enough to keep it visible; table scrollbars also follow the configured always, automatic, or hidden visibility setting.
- **fix(mode shortcuts):** Vditor's `Ctrl/Cmd+Alt+7/8/9` mode shortcuts now update the status-bar mode indicator and preserve the current document position, matching the application menu and status-bar mode picker.

#### Workspace, files, and saving

- **fix(save reliability):** Serialized saves by canonical file identity, kept newer edits dirty and recoverable when an earlier save finishes late, and rechecked the expected disk baseline before replacement so stale saves surface an explicit external-change result.
- **fix(file identity):** Unified file identity across the renderer, preload, and main process so case-sensitive Linux paths, symlink aliases, missing-path ancestors, and watcher cleanup resolve consistently without merging distinct files.
- **fix(file operations):** Prevented Rename and Save As from replacing existing or already-open targets, including targets that appear during the operation; directory renames now converge tab paths, session state, editor rebuilds, the file tree, and watchers after partial failures.
- **fix(save):** Save documents through a synced same-directory temporary file before replacement, preserving existing permissions and keeping the original file intact on write or replacement failure.
- **fix(autosave):** Prevented an application's own atomic-save events from refreshing the workspace explorer or clearing the active file selection.
- **fix(file explorer):** Refresh the active workspace tree immediately after a first save or Save As, without reintroducing save-event flicker for ordinary saves.
- **fix(save baseline):** Recovery-save validation now compares the disk against the recovery snapshot's last saved baseline, allowing a safe recovered version to be written when the original file is unchanged.

#### External changes, watchers, and recovery

- **fix(workspace monitoring):** Workspace watcher resource failures now degrade to one clear in-app notice instead of producing an error storm; manual file browsing and refresh remain available.
- **fix(external conflicts):** Completed the external-change conflict workflow: stable disk snapshots now drive reloads, autosave pauses while a conflict is unresolved, and users can reload, save the current content elsewhere, ignore the change, or explicitly confirm an overwrite. Repeated disk changes invalidate stale overwrite confirmations, and saving after “ignore” still requires an explicit confirmation.
- **fix(watcher consistency):** Discarded out-of-order document reads and reconciled the current disk state after watcher rebinds and workspace transitions, reducing missed external changes during file operations.
- **fix(recovery consistency):** Merged session and recovery tabs for the same file identity, compared recovery baselines through the shared decoding rules for line endings and supported encodings, and preserved trusted tab content while Vditor is still initializing.
- **fix(external file state):** A file that reappears in the active workspace now refreshes the sidebar without rebuilding it for ordinary document content events; reappearance does not silently replace the editor content.

### Project Maintenance

- **docs(0.2.0):** Synchronized README/README_CN, the architecture map, file-safety contract, development plan, execution tracker, theme notes, and cross-platform handoff with the final 0.2.0 worktree. 
- **chore(icons):** Added `lucide-static` as the build-time source for selected SVG assets and removed the manually downloaded symbolic icon copies from the renderer source tree.
- **test(e2e):** split Electron coverage by behavior domain

## 0.1.5 - Editing Experience Improvement

### New Features

- **feat(editor space):** Added a dynamic half-height blank area after the document in all editor modes, keeping the final content comfortably above the status bar.
- **feat(status bar):** Added a compact mode picker for switching between WYSIWYG, IR, and SV directly from the current editor-mode indicator.
- **feat(devtools):** Added a persisted Chrome DevTools switch in Settings > About; disabled shortcuts cannot open DevTools.
- **feat(relative Markdown links):** Ctrl/Cmd-click relative Markdown links now opens the destination in a new or existing tab, supports `../`, percent-encoded file names, and optional heading fragments, and safely rejects unsupported or missing targets.
- **feat(contextual select all):** Ctrl/Cmd+A now selects the current block, table cell, or source line first, then the complete editor on the next press.
- **feat(editor context menu):** Added a localized right-click menu for editing commands in all three modes, with row and column actions for rendered table cells.
- **feat(vditor desktop main menu button):** New cursor hover visual effect.

### Bug Fixes

#### Workbench and toolbar

- **fix(workbench chrome):** Kept the sidebar controls aligned while resizing the explorer, including when no document is open or the editor toolbar is hidden.
- **fix(title bar):** Kept the sidebar toggle fixed in place as related file actions fold away, and limited title-bar shadows to the visible editor-toolbar boundary.
- **fix(menus):** Kept unavailable layout commands visually disabled when hovered or focused.
- **fix(menus):** Automatically close the application menu before showing a sidebar or editor context menu.
- **fix(empty workbench):** Kept the editing-mode menu disabled without a document, while showing a default-mode Vditor toolbar preview; the preview is now fully disabled and gray like other unavailable controls, while its visibility remains configurable from View > Layout.
- **fix(tabs):** Improved light-theme tab hover feedback and made close controls use an accent-only hover state.
- **fix(toolbar layout):** Let the editor toolbar expand vertically when its controls wrap in narrower windows, without adding empty space above the sidebar or shifting the editor when a toolbar menu opens; kept toolbar, sidebar-tab, and hidden-toolbar shadows aligned with their visible boundaries.
- **fix(title bar):** Corrected malformed SVG view boxes for the New, Open, and Save icons.
- **fix(tabs):** Enabled mouse-wheel scrolling for an overflowing document tab strip.
- **fix(outline):** Removed Vditor's duplicate in-editor outline control; the resizable Desktop sidebar outline is now the single outline experience in every editing mode.
- **fix(mode switching):** Removed split-view toolbar button flicker when switching from WYSIWYG or Instant Rendering while keeping list indentation controls available.
- **fix(outline):** Matched Desktop outline collection to Vditor's native current-mode or visible-preview H1–H6 semantics, removing duplicate Markdown parsing and unreliable cross-collection line mapping.
- **fix(outline navigation):** Corrected heading targets when ordinary blocks appear between headings, and scrolls SV preview through its actual outer preview container.
- **fix(empty outline state):** Kept the empty-outline message below the Files/Outline controls in fullscreen and made it non-selectable when no document is open.
- **fix(confirmation dialogs):** Unsaved-changes and move-to-trash confirmations can now be dragged within the application window without becoming resizable.

#### Editor and document navigation

- **fix(document navigation):** Smoothed find-result navigation and prevented unnecessary movement when jumping between nearby outline headings.
- **fix(editor position):** Kept the current document position for regular Markdown documents when changing editing modes, restoring it before the first paint instead of briefly flashing the document top.
- **fix(editor layout):** Kept full-width paragraphs and editor markers within the visible editing area in WYSIWYG and Instant Rendering modes.
- **fix(raw HTML typography):** Raw HTML previews in WYSIWYG and Instant Rendering now use the configured rendered text font and size instead of inheriting code-block typography.
- **fix(SV line numbers):** Made the source line-number gutter non-selectable, aligned numbers to the vertical center of source text, kept blank source lines from stacking at the gutter top after scrolling, and excluded the editor's trailing blank space from its numbered track.

#### Links and local resources

- **fix(in-document links):** Unified hash-link and table-of-contents navigation across all editor modes: ordinary clicks retain editing context and show a platform-aware Ctrl/Cmd-click hint; Ctrl/Cmd-click scrolls smoothly to the target heading.
- **fix(external links):** Unified `http(s)` and `mailto:` link handling across all editor modes: ordinary clicks remain editable and Ctrl/Cmd-click opens the link through the validated system handler. Navigation and new-window requests use the same protocol allowlist. Link hover uses a text cursor normally and a hand cursor while the navigation modifier is held.
- **fix(relative images):** Resolved Markdown-relative image paths against the active document directory even when Vditor first converts them to app-protocol URLs.
- **fix(relative images):** Resolved Markdown-relative image paths before Vditor renders them, preventing transient `app://` 404 requests while preserving the original Markdown source.

#### Settings and themes

- **fix(settings):** New documents now use the configured default editing mode instead of inheriting the last mode used by another document.
- **fix(settings controls):** Matched settings select focus, checkbox, and range accents to the active application theme, and enabled Escape to close the settings dialog.
- **fix(monokai theme):** Prevented raw HTML blocks in Instant Rendering mode from being painted as Monokai code blocks and aligned its link color with WYSIWYG and Split Preview.

### Project Maintenance

- **docs(code structure)**: New development document: [`01-CODE-STRUCTURE.md`](docs/01-CODE-STRUCTURE.md)

## 0.1.3

### New Features

- **feat(workbench layout):** Reworked the desktop workbench into a compact two-row layout.
   - Moved file actions and document tabs into the window workbench bar, reducing the editor's fixed top chrome.
   - Made the explorer toggle fold its related file-action buttons away with a smooth layout transition, leaving more room for the editor.
   - Added drag-and-drop tab reordering and kept the active tab visible in an overflowing tab strip.
   - Moved Files and Outline switching beside the fixed editor toolbar, simplified the application menus, and retained `F11` fullscreen.
- **feat(workspace explorer):** Extended the workspace file workflow.
   - Create numbered Untitled tabs without colliding with existing `Untitled N.md` files in the workspace.
   - Save an Untitled document through a dialog that opens in the active workspace by default.
   - Replace prompt-based file renaming with inline rename, preserving the original extension.
   - Add a workspace context-menu action to open the current folder in the system file manager.
   - Close tabs for files moved to the trash and refresh the explorer after file operations.
- **feat(find and replace):** Added a full find and replace experience for the active document. Vditor does not provide a complete built-in find and replace tool, so Vditor Desktop now supplies the missing desktop-editor experience while keeping your Markdown content unchanged.
   - Press `Ctrl/Cmd + F` to open a compact VS Code-style find panel.
   - See the current result and total result count, jump forward or backward through matches with buttons, `Enter`, `Shift+Enter`, `F3`, or `Shift+F3`, and wrap around at the beginning or end of the document.
   - All matches are highlighted in the editor, while the current match is shown more clearly and scrolled into view.
   - Expand the replace row when needed, then replace the current match or replace every match in the active document.
   - Search results and replacements stay consistent across WYSIWYG, Instant Rendering, and Split Preview modes.
   - The find field keeps keyboard focus while you type, and `Esc` returns focus to the current match so you can continue editing immediately.
   - `Ctrl/Cmd + S` continues to save the document even while the find or replace field is active.

### Bug Fixes

- **fix(dark content themes):** Corrected Ant Design and WeChat rendering colors in Dark and Monokai Pro Dark themes, including inline code, tables, links, blockquotes, and heading text across all three editing modes.
- **fix(external changes):** Added independent document monitoring for every open file, including files outside the active workspace. Clean documents reload automatically; locally modified documents retain a persistent conflict indicator and banner, and autosave pauses until the conflict is addressed.
   - Separated workspace structural events from per-document content watchers, so external content updates no longer rebuild the sidebar or lose its active selection.
   - Wait for stable document content, compare it with the expected saved content, and rebind Linux document watches after atomic replacement writes.
   - Keep monitoring an open external file after switching workspaces or closing and reopening it from the file explorer.
   - “Reload” discards the local tab content and reads the current disk version.
   - “Ignore” keeps the tab content and requires an explicit manual save to overwrite the file; autosave remains paused.
   - Untitled tabs whose expected workspace path is created now enter the same conflict flow instead of being blocked by explorer naming rules.
- **fix(hidden toolbar layout):** Removed the empty top gap when fullscreen is used with the fixed toolbar hidden or unavailable, and improved sidebar/file-action collapse transitions.

### Known Limitations

- Deletion, directory moves, and conflict state recovery across application restarts remain planned work.
- Windows and macOS watcher behavior, path-case semantics, and atomic replacement events still require physical-device verification.

## 0.1.2

### New Features

- **feat(toolbar controls):** Moved the redesigned sidebar toggle into the title bar beside the File menu, removed the duplicate toolbar settings button, and refreshed the Open File folder icon.
- **feat(in-doc links):** Added clickable in-document link navigation in all three editing modes, including links in preview tables of contents.
- **feat(document outline):** Added hierarchical expand and collapse controls to the document outline sidebar.
- **feat(workspace state):** Added persistent directory expansion state, with collapsed top-level directories by default and restoration when returning to a workspace.
- **feat(scrollbars):** Added configurable always-visible, auto-hide, and always-hidden scrollbar modes across the editor, sidebars, and settings pages.
- **feat(navigation):** Added animated scrollbar visibility transitions and smoother outline navigation scrolling.
- **feat(about page):** Added a short commit hash and a link to the corresponding GitHub commit.
- **feat(surface shadows):** Added theme-aware top shadows to the explorer, document outline, and editor content boundaries, adapting to the visible toolbar and tab-bar layout.

### Bug Fixes

- **fix(view layout):** Keep the Layout submenu open after toggling a layout option so multiple visibility settings can be adjusted without reopening the menu.
- **fix(settings selection):** Prevent accidental text selection across the settings page while preserving selection in editable fields.
- **fix(code theme settings):** Complete the settings-page code-theme list so light and dark modes expose the same full set of Vditor code-block preview themes.
- **fix(content typography):** Ensure Ant Design and other content themes inherit the configured application font for all rendered heading levels, including level six.
- **fix(settings):** Restored the settings-page close animation when saving settings.
- **fix(status bar):** Prevented status-bar text from being selected.
- **fix(document outline):** Replaced harsh pure white and pure black outline text with softer theme-aware gray tones.
- **fix(editor state):** Preserved the document scroll position when settings changes rebuild the editor.
- **fix(scrollbars):** Slowed scrollbar show/hide transitions for a smoother animation.
- **fix(about page):** Corrected the commit hash and GitHub link to reference the intended release tag.
- **fix(app menus):** Automatically close open menus when the application window loses focus.

### Project Maintenance

- chore(docs structure): Clarified the responsibilities and reading order of the `docs/` directory, separating issue tracking, version plans, upgrade procedures, and long-term ideas.
- chore(release planning): Updated the 0.2.0 plan baseline to 0.1.2 and documented the future 0.2.0 → 0.2.5 development sequence.
