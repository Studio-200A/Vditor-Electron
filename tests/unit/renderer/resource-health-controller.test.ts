// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ResourceHealthController } from '../../../src/renderer/resource-health/resource-health-controller';

const translate = (key: string, variables: Record<string, string | number> = {}): string =>
  `${key}:${Object.values(variables).join(',')}`;

describe('ResourceHealthController', () => {
  it('restores and persists a customized dialog size', () => {
    const persistDialogSize = vi.fn();
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => null,
      getWorkspacePath: () => '',
      getDialogSize: () => ({ width: 860, height: 620, customized: true }),
      persistDialogSize,
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });

    controller.open();
    const card = document.querySelector<HTMLElement>(
      '.resource-health-modal:last-child .resource-health-card',
    );
    expect(card?.style.width).toBe('860px');
    expect(card?.style.height).toBe('620px');
    card
      ?.querySelector<HTMLElement>('[data-resource-health-resize="se"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(persistDialogSize).toHaveBeenCalledWith(expect.objectContaining({ customized: true }));
    controller.dispose();
  });

  it('blocks destructive actions when the scan is incomplete', async () => {
    const scanResourceHealth = vi.fn().mockResolvedValue({
      revision: 'scan-1',
      candidates: [
        {
          id: 'candidate-1',
          relativePath: 'assets/orphan.png',
          name: 'orphan.png',
          size: 1024,
          modifiedAt: 1,
          previewAvailable: true,
        },
      ],
      missingReferences: [],
      candidateBytes: 1024,
      scannedSourceFiles: 1,
      limitations: { complete: false, skipped: { 'read-failed': 1 } },
    });
    const trashResourceHealthCandidates = vi.fn();
    const previewResourceHealthCandidate = vi
      .fn()
      .mockResolvedValue('local-file://root/preview.png');
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth,
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate,
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates,
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });

    controller.open();
    await vi.waitFor(() => expect(scanResourceHealth).toHaveBeenCalledOnce());
    expect(previewResourceHealthCandidate).not.toHaveBeenCalled();
    const checkbox = document.querySelector<HTMLInputElement>('.resource-health-candidate input');
    checkbox?.click();
    await vi.waitFor(() => expect(previewResourceHealthCandidate).toHaveBeenCalledOnce());
    const trash = document.querySelector<HTMLButtonElement>('.resource-health-trash');
    expect(trash?.disabled).toBe(true);
    expect(trash?.classList.contains('primary')).toBe(true);
    expect(trash?.classList.contains('danger')).toBe(true);
    trash?.click();
    expect(trashResourceHealthCandidates).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('copies a candidate relative path without exposing a filesystem path', async () => {
    const writeClipboard = vi.fn();
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-copy',
          documentRelativePath: 'note.md',
          imageDirectoryRelativePath: 'assets',
          workspaceName: 'workspace',
          savedAt: 1,
          candidates: [
            {
              id: 'candidate-copy',
              relativePath: 'assets/orphan.png',
              name: 'orphan.png',
              size: 1024,
              modifiedAt: 1,
              previewAvailable: false,
            },
          ],
          missingReferences: [],
          candidateBytes: 1024,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard,
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelector('.resource-health-candidate')).not.toBeNull(),
    );
    const candidate = document.querySelector<HTMLElement>('.resource-health-candidate');
    const candidateCheckbox = candidate?.querySelector<HTMLInputElement>('input');
    candidate?.click();
    expect(candidateCheckbox?.checked).toBe(false);
    expect(candidate?.classList.contains('is-active')).toBe(true);
    document.querySelector<HTMLInputElement>('.resource-health-candidate input')?.click();
    expect(
      document.querySelector('.resource-health-candidate')?.classList.contains('is-selected'),
    ).toBe(true);
    expect(document.querySelector('.resource-health-hover-preview')).toBeNull();
    expect(document.querySelector('.resource-health-candidate-detail')?.textContent).toContain(
      'resourceHealth.previewUnavailable:',
    );
    expect(document.querySelector('.resource-health-selection-summary')?.textContent).toContain(
      '1,1 KB',
    );
    expect(document.querySelector('.resource-health-scan-metadata')?.textContent).toContain(
      'note.md',
    );
    expect(document.querySelector('.resource-health-summary-document-title')?.textContent).toBe(
      'note.md',
    );
    expect(
      document.querySelector('.resource-health-summary-document-title')?.getAttribute('title'),
    ).toBe('note.md');
    expect(document.querySelector('.resource-health-summary-counts')?.textContent).toContain(
      'resourceHealth.summaryCounts',
    );
    expect(document.querySelector('.resource-health-scan-status-text')?.textContent).toContain(
      'resourceHealth.scanStatus.complete',
    );
    expect(document.querySelector('.resource-health-status-animation')?.tagName).toBe('DIV');
    expect(
      document.querySelector('.resource-health-status-animation')?.classList.contains('hidden'),
    ).toBe(false);
    expect(document.querySelectorAll('.resource-health-status-animation path')).toHaveLength(2);
    expect(document.querySelectorAll('.resource-health-status-animation rect')).toHaveLength(58);
    expect(document.querySelector('.resource-health-scan-metadata')?.textContent).toContain(
      'resourceHealth.scanDetail.snapshot',
    );
    expect(document.querySelector('.resource-health-workspace')?.textContent).toBe('workspace');
    expect(document.querySelector('.resource-health-workspace')?.classList.contains('hidden')).toBe(
      false,
    );
    expect(
      document.querySelector('.resource-health-workspace-icon')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(document.querySelector('.resource-health-unsaved-notice')?.textContent).toContain(
      'resourceHealth.unsavedNotice',
    );
    expect(document.querySelector('.resource-health-notice-icon')?.tagName).toBe('SPAN');
    expect(
      document.querySelector('.resource-health-overlay .resource-health-analyzing-image'),
    ).toBeNull();
    document.querySelector<HTMLButtonElement>('.resource-health-candidate button')?.click();
    expect(writeClipboard).toHaveBeenCalledWith('assets/orphan.png');
    document.querySelector<HTMLButtonElement>('.resource-health-tabs button:nth-child(2)')?.click();
    expect(
      document.querySelector<HTMLButtonElement>('.resource-health-remove-missing')?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('.resource-health-remove-missing')?.disabled,
    ).toBe(true);
    controller.dispose();
  });

  it('refreshes the title from the active locale when the page opens', () => {
    let resourceHealthTitle = 'Resource Health';
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => null,
      getWorkspacePath: () => '',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate: (key) => (key === 'resourceHealth.title' ? resourceHealthTitle : key),
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });

    resourceHealthTitle = '资源健康';
    controller.open();
    expect(
      document.querySelector('.resource-health-modal:last-child #resource-health-title')
        ?.textContent,
    ).toBe('资源健康');
    controller.dispose();
  });

  it('renders the warning overlay when no workspace document is available', () => {
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => null,
      getWorkspacePath: () => '',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });

    controller.open();
    expect(document.querySelector('.resource-health-overlay-error')).not.toBeNull();
    expect(
      document.querySelector<HTMLImageElement>('.resource-health-warning-icon')?.src,
    ).toContain('assets/notification/warning.svg');
    expect(document.querySelector('.resource-health-overlay')?.getAttribute('role')).toBe('alert');
    expect(document.querySelector<HTMLElement>('.resource-health-body')?.inert).toBe(true);
    document.querySelector<HTMLButtonElement>('.resource-health-overlay-close')?.click();
    expect(
      document
        .querySelector('.resource-health-modal:last-child')
        ?.classList.contains('modal-closing'),
    ).toBe(true);
    controller.dispose();
  });

  it('shows a dedicated unavailable overlay for a symbolic-link workspace root', async () => {
    const scanResourceHealth = vi
      .fn()
      .mockResolvedValue({ unavailableReason: 'workspace-symbolic-link' });
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth,
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace-link/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace-link',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });

    controller.open();
    await vi.waitFor(() => expect(scanResourceHealth).toHaveBeenCalledOnce());
    expect(document.querySelector('.resource-health-overlay-error')).not.toBeNull();
    expect(document.querySelector('.resource-health-overlay-text')?.textContent).toBe(
      'resourceHealth.workspace-symbolic-link:',
    );
    expect(document.querySelector('.resource-health-overlay-description')?.textContent).toBe(
      'resourceHealth.workspaceSymbolicLinkHint:',
    );
    expect(document.querySelector('.resource-health-open-workspace')).toBeNull();
    expect(document.querySelector<HTMLElement>('.resource-health-body')?.inert).toBe(true);
    controller.dispose();
  });

  it('moves focus to the loading overlay and restores it when closed', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    let resolveScan: ((summary: object) => void) | undefined;
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveScan = resolve;
            }),
        ),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });
    controller.open();
    expect(document.activeElement).toBe(
      document.querySelector('.resource-health-modal:last-child .resource-health-overlay'),
    );
    resolveScan?.({
      revision: 'scan-focus',
      candidates: [],
      missingReferences: [],
      candidateBytes: 0,
      scannedSourceFiles: 1,
      limitations: { complete: true, skipped: {} },
    });
    await vi.waitFor(() =>
      expect(
        document
          .querySelector('.resource-health-modal:last-child .resource-health-overlay')
          ?.classList.contains('hidden'),
      ).toBe(true),
    );
    expect(document.activeElement).toBe(
      document.querySelector('.resource-health-modal:last-child .resource-health-rescan'),
    );
    controller.close();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    controller.dispose();
  });

  it('ignores a late scan result after the resource-health page closes', async () => {
    let resolveScan: ((summary: object) => void) | undefined;
    const discardResourceHealthScans = vi.fn();
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveScan = resolve;
            }),
        ),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
        discardResourceHealthScans,
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });

    controller.open();
    controller.close();
    resolveScan?.({
      revision: 'late-scan',
      candidates: [],
      missingReferences: [],
      candidateBytes: 0,
      scannedSourceFiles: 1,
      limitations: { complete: true, skipped: {} },
    });
    await Promise.resolve();

    expect(discardResourceHealthScans).toHaveBeenCalledOnce();
    expect(
      document
        .querySelector('.resource-health-modal:last-child')
        ?.classList.contains('modal-closing'),
    ).toBe(true);
    expect(document.querySelector('.resource-health-candidate')).toBeNull();
    controller.dispose();
  });

  it('expires a scan result when the focused document changes while scanning', async () => {
    let resolveScan: ((summary: object) => void) | undefined;
    let activeDocument = { filePath: '/workspace/current.md', title: 'current.md' };
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveScan = resolve;
            }),
        ),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => activeDocument,
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });

    controller.open();
    activeDocument = { filePath: '/workspace/README.md', title: 'README.md' };
    resolveScan?.({
      revision: 'stale-document-scan',
      candidates: [],
      missingReferences: [],
      candidateBytes: 0,
      scannedSourceFiles: 1,
      limitations: { complete: true, skipped: {} },
    });

    await vi.waitFor(() =>
      expect(document.querySelector('.resource-health-overlay')?.textContent).toContain(
        'resourceHealth.stale:',
      ),
    );
    expect(document.querySelector('.resource-health-candidate')).toBeNull();
    controller.dispose();
  });

  it('expires a completed scan and discards its revision when invalidated', async () => {
    const discardResourceHealthScans = vi.fn();
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-stale',
          candidates: [
            {
              id: 'candidate-stale',
              relativePath: 'assets/orphan.png',
              name: 'orphan.png',
              size: 1,
              modifiedAt: 1,
              previewAvailable: false,
            },
          ],
          missingReferences: [],
          candidateBytes: 1,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
        discardResourceHealthScans,
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });

    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelector('.resource-health-candidate')).not.toBeNull(),
    );
    controller.invalidate();

    expect(discardResourceHealthScans).toHaveBeenCalledOnce();
    expect(document.querySelector('.resource-health-overlay-error')).not.toBeNull();
    expect(document.querySelector('.resource-health-overlay')?.textContent).toContain(
      'resourceHealth.stale:',
    );
    expect(document.querySelector<HTMLButtonElement>('.resource-health-trash')?.disabled).toBe(
      true,
    );
    controller.dispose();
  });

  it('uses the modal-card header as a draggable page handle without dragging its close button', () => {
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn(),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => null,
      getWorkspacePath: () => '',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });
    const card = document.querySelector<HTMLElement>('.resource-health-card:last-child');
    const header = card?.querySelector('header');
    header?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(card?.classList.contains('modal-card')).toBe(true);
    expect(card?.style.position).toBe('absolute');
    card
      ?.querySelector('button')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(card?.style.position).toBe('absolute');
    controller.dispose();
  });

  it('switches between unreferenced and missing-resource result tabs', async () => {
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-2',
          candidates: [],
          missingReferences: [
            { targetPath: 'assets/missing.png', source: 'assets/missing.png', locations: [] },
          ],
          candidateBytes: 0,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelector('.resource-health-missing')?.hidden).toBe(true),
    );
    document.querySelector<HTMLButtonElement>('.resource-health-tabs button:nth-child(2)')?.click();
    expect(document.querySelector('.resource-health-missing')?.hidden).toBe(false);
    expect(document.querySelector('.resource-health-missing')).not.toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.resource-health-remove-missing')?.hidden,
    ).toBe(false);
    expect(document.querySelector('.resource-health-candidate-detail')?.hidden).toBe(true);
    const footerButtons = Array.from(
      document.querySelectorAll('.resource-health-card > footer button'),
    );
    expect(
      footerButtons.indexOf(document.querySelector('.resource-health-remove-missing')),
    ).toBeLessThan(footerButtons.indexOf(document.querySelector('.resource-health-trash')));
    expect(
      document.querySelector<HTMLButtonElement>('.resource-health-remove-missing')?.disabled,
    ).toBe(true);
    controller.dispose();
  });

  it('names the dialog and exposes every missing-reference location', async () => {
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-locations',
          candidates: [],
          candidateBytes: 0,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
          missingReferences: [
            {
              targetPath: 'assets/missing.png',
              source: 'assets/missing.png',
              locations: [
                { line: 2, column: 3, raw: '![one](assets/missing.png)' },
                { line: 6, column: 1, raw: '<img src="assets/missing.png">' },
              ],
            },
          ],
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.resource-health-missing-locations li')).toHaveLength(2),
    );
    const modal = document.querySelector('.resource-health-modal:last-child');
    expect(modal?.getAttribute('aria-labelledby')).toBe('resource-health-title');
    expect(document.querySelector('#resource-health-title')).not.toBeNull();
    expect(document.querySelector('.resource-health-missing-locations')?.textContent).toContain(
      'resourceHealth.location:2,3',
    );
    expect(document.querySelectorAll('.resource-health-missing-locations button')).toHaveLength(2);
    controller.dispose();
  });

  it('removes a current missing-reference location and expires the result', async () => {
    const removeImageReference = vi.fn().mockReturnValue(true);
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-3',
          candidates: [],
          missingReferences: [
            {
              targetPath: 'assets/missing.png',
              source: 'assets/missing.png',
              locations: [{ line: 2, column: 1, raw: '![gone](assets/missing.png)' }],
            },
          ],
          candidateBytes: 0,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => ({
        host: document.body,
        mode: 'sv',
        content: '![gone](assets/missing.png)',
      }),
      removeImageReference,
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn().mockResolvedValue(true),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelector('.resource-health-missing-item')).not.toBeNull(),
    );
    document
      .querySelector<HTMLButtonElement>('.resource-health-missing-item button:last-child')
      ?.click();
    await vi.waitFor(() =>
      expect(removeImageReference).toHaveBeenCalledWith(
        { host: document.body, mode: 'sv', content: '![gone](assets/missing.png)' },
        '![gone](assets/missing.png)',
        'assets/missing.png',
      ),
    );
    expect(document.querySelector('.resource-health-overlay-error')).not.toBeNull();
    controller.dispose();
  });

  it('does not remove an HTML-derived missing reference with an incomplete edit range', async () => {
    const removeImageReference = vi.fn();
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-html-reference',
          candidates: [],
          missingReferences: [
            {
              targetPath: 'assets/missing.png',
              source: 'assets/missing.png',
              locations: [{ line: 1, column: 10, raw: 'assets/missing.png', removable: false }],
            },
          ],
          candidateBytes: 0,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => ({
        host: document.body,
        mode: 'sv',
        content: '<img src="assets/missing.png">',
      }),
      removeImageReference,
      confirmRemoveReference: vi.fn().mockResolvedValue(true),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('.resource-health-missing-item button:last-child')
          ?.disabled,
      ).toBe(true),
    );
    document
      .querySelector<HTMLButtonElement>('.resource-health-missing-item button:last-child')
      ?.click();
    expect(removeImageReference).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('removes selected missing targets in one confirmed batch', async () => {
    const removeImageReference = vi.fn().mockReturnValue(true);
    const confirmRemoveReferences = vi.fn().mockResolvedValue(true);
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth: vi.fn().mockResolvedValue({
          revision: 'scan-batch',
          candidates: [],
          candidateBytes: 0,
          scannedSourceFiles: 1,
          limitations: { complete: true, skipped: {} },
          missingReferences: [
            {
              targetPath: 'assets/a.png',
              source: 'assets/a.png',
              locations: [{ line: 1, column: 1, raw: '![a](assets/a.png)' }],
            },
            {
              targetPath: 'assets/b.png',
              source: 'assets/b.png',
              locations: [{ line: 2, column: 1, raw: '![b](assets/b.png)' }],
            },
          ],
        }),
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates: vi.fn(),
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => ({
        host: document.body,
        mode: 'sv',
        content: '![a](assets/a.png)\n![b](assets/b.png)',
      }),
      removeImageReference,
      confirmRemoveReferences,
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash: vi.fn(),
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.resource-health-missing-item')).toHaveLength(2),
    );
    document.querySelector<HTMLButtonElement>('.resource-health-tabs button:nth-child(2)')?.click();
    document
      .querySelectorAll<HTMLInputElement>('.resource-health-missing-item input')
      .forEach((input) => input.click());
    document.querySelector<HTMLButtonElement>('.resource-health-remove-missing')?.click();
    await vi.waitFor(() => expect(confirmRemoveReferences).toHaveBeenCalledOnce());
    expect(removeImageReference).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('refreshes the scan after a partially successful Trash operation', async () => {
    const confirmMoveToTrash = vi.fn().mockResolvedValue(true);
    const trashResourceHealthCandidates = vi.fn().mockResolvedValue([
      { id: 'candidate-a', code: 'trashed' },
      { id: 'candidate-b', code: 'changed-since-scan' },
    ]);
    const scanResourceHealth = vi.fn().mockResolvedValue({
      revision: 'scan-partial-trash',
      candidates: [
        {
          id: 'candidate-a',
          relativePath: 'assets/a.png',
          name: 'a.png',
          size: 128,
          modifiedAt: 1,
          previewAvailable: false,
        },
        {
          id: 'candidate-b',
          relativePath: 'assets/b.png',
          name: 'b.png',
          size: 256,
          modifiedAt: 2,
          previewAvailable: false,
        },
      ],
      missingReferences: [],
      candidateBytes: 384,
      scannedSourceFiles: 1,
      limitations: { complete: true, skipped: {} },
    });
    const controller = new ResourceHealthController({
      document,
      appAPI: {
        scanResourceHealth,
        revealResourceHealthCandidate: vi.fn(),
        previewResourceHealthCandidate: vi.fn(),
        writeClipboard: vi.fn(),
        trashResourceHealthCandidates,
      },
      getActiveDocument: () => ({ filePath: '/workspace/note.md', title: 'note.md' }),
      getWorkspacePath: () => '/workspace',
      getActiveEditor: () => null,
      removeImageReference: vi.fn(),
      translate,
      openWorkspace: vi.fn(),
      confirmMoveToTrash,
    });
    controller.open();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.resource-health-candidate input')).toHaveLength(2),
    );
    document
      .querySelectorAll<HTMLInputElement>('.resource-health-candidate input')
      .forEach((input) => input.click());
    document.querySelector<HTMLButtonElement>('.resource-health-trash')?.click();
    await vi.waitFor(() => expect(confirmMoveToTrash).toHaveBeenCalledOnce());
    expect(confirmMoveToTrash).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'assets/a.png', size: 128 }),
        expect.objectContaining({ relativePath: 'assets/b.png', size: 256 }),
      ]),
    );
    await vi.waitFor(() => expect(scanResourceHealth).toHaveBeenCalledTimes(2));
    controller.dispose();
  });
});
