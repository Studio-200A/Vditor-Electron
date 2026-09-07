// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialogLayoutController } from '../../../src/renderer/settings/settings-dialog-layout-controller';

function fixture() {
  document.body.innerHTML =
    '<section class="card"><header>Settings</header><button></button><i data-settings-resize="se"></i></section>';
  const card = document.querySelector<HTMLElement>('.card')!;
  Object.defineProperties(card, {
    offsetLeft: { configurable: true, get: () => Number.parseFloat(card.style.left) || 0 },
    offsetTop: { configurable: true, get: () => Number.parseFloat(card.style.top) || 0 },
    offsetWidth: { configurable: true, get: () => Number.parseFloat(card.style.width) || 0 },
    offsetHeight: { configurable: true, get: () => Number.parseFloat(card.style.height) || 0 },
  });
  const onPersist = vi.fn();
  const onWindowResize = vi.fn();
  const controller = new SettingsDialogLayoutController({ card, onPersist, onWindowResize });
  return { card, onPersist, onWindowResize, controller };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('SettingsDialogLayoutController', () => {
  it('restores a bounded centered default or custom geometry', () => {
    const { card, controller } = fixture();
    controller.restore(undefined);
    expect(card.style.position).toBe('fixed');
    expect(Number.parseFloat(card.style.width)).toBeGreaterThan(0);
    controller.restore({ width: 1, height: 100_000, customized: true });
    expect(Number.parseFloat(card.style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(card.style.height)).toBeGreaterThan(0);
  });

  it('moves only from the header and ignores header buttons', () => {
    const { card, controller } = fixture();
    controller.restore({ width: 620, height: 420, customized: true });
    controller.init();
    card
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300 }));
    expect(card.style.left).not.toBe('300px');
    card
      .querySelector('header')!
      .dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 110 }));
    expect(Number.parseFloat(card.style.left)).toBeGreaterThanOrEqual(0);
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('persists resized geometry and removes active window listeners on dispose', () => {
    const { card, controller, onPersist, onWindowResize } = fixture();
    controller.restore({ width: 620, height: 420, customized: true });
    controller.init();
    card
      .querySelector<HTMLElement>('[data-settings-resize]')!
      .dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(onPersist).toHaveBeenCalledWith(expect.objectContaining({ customized: true }));
    controller.dispose();
    window.dispatchEvent(new Event('resize'));
    expect(onWindowResize).not.toHaveBeenCalled();
  });
});
