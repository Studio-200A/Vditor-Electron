# Changelog

## 0.2.0 - Under-the-Hood Robustness Improvement

### New Features

- **feat(recovery):** After an unexpected exit, unsaved documents now open directly with a persistent warning banner. The banner clearly distinguishes an unchanged original file from a changed or unavailable one, and only allows direct saving when it is safe; other recovery states can be saved elsewhere or discarded.

### Bug Fixes

- **fix(context menu):** Disabled Paste and Paste as Plain Text when the system clipboard has no content to insert.
- **fix(save):** Save documents through a synced same-directory temporary file before replacement, preserving existing permissions and keeping the original file intact on write or replacement failure.
- **fix(autosave):** Prevented an application's own atomic-save events from refreshing the workspace explorer or clearing the active file selection.
- **fix(file explorer):** Refresh the active workspace tree immediately after a first save or Save As, without reintroducing save-event flicker for ordinary saves.
- **fix(accessibility):** Use the active theme accent for keyboard-visible focus rings across application controls.

### Project Maintenance

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
- **fix(external changes):** Added workspace file-change handling that reloads clean open documents, marks locally modified documents with a persistent conflict indicator and banner, and pauses autosave until the conflict is addressed.
   - “Reload” discards the local tab content and reads the current disk version.
   - “Ignore” keeps the tab content and requires an explicit manual save to overwrite the file; autosave remains paused.
   - Untitled tabs whose expected workspace path is created now enter the same conflict flow instead of being blocked by explorer naming rules.
- **fix(hidden toolbar layout):** Removed the empty top gap when fullscreen is used with the fixed toolbar hidden or unavailable, and improved sidebar/file-action collapse transitions.

### Known Limitations

- External monitoring currently follows the active workspace; files opened outside it are not yet watched.
- Deletion, directory moves, atomic replacement writes, and conflict state recovery across application restarts remain planned work.

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
