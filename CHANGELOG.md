# Changelog

## 0.1.5 - Editing Experience Improvement

### New Features

### Bug Fixes

### Project Maintenance

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
