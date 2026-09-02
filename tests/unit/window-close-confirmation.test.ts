import { describe, expect, it } from 'vitest';
import { WindowCloseConfirmation } from '../../src/main/services/window-close-confirmation';

describe('WindowCloseConfirmation', () => {
  it('requires a newly created window to obtain its own close confirmation', () => {
    const confirmation = new WindowCloseConfirmation<object>();
    const firstWindow = {};
    const replacementWindow = {};

    expect(confirmation.isConfirmed(firstWindow)).toBe(false);
    confirmation.confirm(firstWindow);
    expect(confirmation.isConfirmed(firstWindow)).toBe(true);
    expect(confirmation.isConfirmed(replacementWindow)).toBe(false);
  });

  it('clears a closed window confirmation without affecting another window', () => {
    const confirmation = new WindowCloseConfirmation<object>();
    const firstWindow = {};
    const replacementWindow = {};

    confirmation.confirm(firstWindow);
    confirmation.clear(replacementWindow);
    expect(confirmation.isConfirmed(firstWindow)).toBe(true);

    confirmation.clear(firstWindow);
    expect(confirmation.isConfirmed(firstWindow)).toBe(false);
    expect(confirmation.isConfirmed(replacementWindow)).toBe(false);
  });
});
