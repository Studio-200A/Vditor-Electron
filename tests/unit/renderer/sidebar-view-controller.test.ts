// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarViewController } from '../../../src/renderer/ui/sidebar-view-controller';

function fixture() {
  document.body.innerHTML = `
    <nav id="navigation">
      <button data-view="files" class="active" aria-selected="true">Files</button>
      <button data-view="outline" aria-selected="false">Outline</button>
    </nav>
    <section id="filesView" class="active"></section>
    <section id="outlineView"></section>`;
  const onOutlineSelected = vi.fn();
  const controller = new SidebarViewController({
    navigation: document.getElementById('navigation')!,
    views: [document.getElementById('filesView')!, document.getElementById('outlineView')!],
    onOutlineSelected,
  });
  return { controller, onOutlineSelected };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('SidebarViewController', () => {
  it('selects the outline view and preserves accessible selected state', () => {
    const { controller, onOutlineSelected } = fixture();
    controller.init();
    document.querySelector<HTMLButtonElement>('[data-view="outline"]')!.click();

    expect(document.getElementById('filesView')?.classList.contains('active')).toBe(false);
    expect(document.getElementById('outlineView')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-view="files"]')?.getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(document.querySelector('[data-view="outline"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(onOutlineSelected).toHaveBeenCalledOnce();
  });

  it('removes its delegated listener on disposal', () => {
    const { controller, onOutlineSelected } = fixture();
    controller.init();
    controller.dispose();
    document.querySelector<HTMLButtonElement>('[data-view="outline"]')!.click();

    expect(onOutlineSelected).not.toHaveBeenCalled();
    expect(document.getElementById('filesView')?.classList.contains('active')).toBe(true);
  });
});
