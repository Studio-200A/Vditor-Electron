// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AppTooltipController } from '../../../src/renderer/ui/app-tooltip-controller';

function fixture() {
  document.body.innerHTML =
    '<aside id="sidebar"><button id="target" data-tooltip="Open folder"><span>icon</span></button></aside><div id="tooltip" hidden></div>';
  const tooltip = document.getElementById('tooltip')!;
  const sidebar = document.getElementById('sidebar')!;
  const controller = new AppTooltipController({ tooltip, sidebar, window });
  return { controller, sidebar, tooltip, target: document.getElementById('target')! };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('AppTooltipController', () => {
  it('shows and moves the shared tooltip for delegated sidebar targets', () => {
    const f = fixture();
    f.controller.init();
    f.target.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, clientX: 20, clientY: 30 }),
    );
    expect(f.tooltip.hidden).toBe(false);
    expect(f.tooltip.textContent).toBe('Open folder');
    expect(f.tooltip.style.left).toBe('32px');
    expect(f.tooltip.style.top).toBe('48px');

    f.target.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 50 }),
    );
    expect(f.tooltip.style.left).toBe('52px');
    expect(f.tooltip.style.top).toBe('68px');
  });

  it('hides on sidebar exit and releases listeners on disposal', () => {
    const f = fixture();
    f.controller.init();
    f.target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    f.target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(f.tooltip.hidden).toBe(true);

    f.controller.dispose();
    f.target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(f.tooltip.hidden).toBe(true);
  });
});
