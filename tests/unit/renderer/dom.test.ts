/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { requiredElement, optionalElement } from '../../../src/renderer/core/dom';

describe('dom helpers', () => {
  describe('requiredElement', () => {
    it('returns the element when it exists', () => {
      const div = document.createElement('div');
      div.id = 'test-element';
      document.body.appendChild(div);
      try {
        const result = requiredElement('#test-element');
        expect(result).toBe(div);
      } finally {
        document.body.removeChild(div);
      }
    });

    it('throws an error with the selector when element is missing', () => {
      expect(() => requiredElement('#nonexistent')).toThrow(
        'Required element not found: #nonexistent',
      );
    });

    it('accepts a custom root node', () => {
      const container = document.createElement('div');
      const child = document.createElement('span');
      child.className = 'target';
      container.appendChild(child);
      document.body.appendChild(container);
      try {
        const result = requiredElement('.target', container);
        expect(result).toBe(child);
      } finally {
        document.body.removeChild(container);
      }
    });

    it('supports generic type parameter', () => {
      const button = document.createElement('button');
      button.id = 'test-button';
      document.body.appendChild(button);
      try {
        const result = requiredElement<HTMLButtonElement>('#test-button');
        expect(result.tagName).toBe('BUTTON');
      } finally {
        document.body.removeChild(button);
      }
    });
  });

  describe('optionalElement', () => {
    it('returns the element when it exists', () => {
      const div = document.createElement('div');
      div.id = 'optional-element';
      document.body.appendChild(div);
      try {
        const result = optionalElement('#optional-element');
        expect(result).toBe(div);
      } finally {
        document.body.removeChild(div);
      }
    });

    it('returns null when element is missing', () => {
      const result = optionalElement('#nonexistent-optional');
      expect(result).toBeNull();
    });

    it('accepts a custom root node', () => {
      const container = document.createElement('div');
      const child = document.createElement('span');
      child.className = 'optional-target';
      container.appendChild(child);
      document.body.appendChild(container);
      try {
        const found = optionalElement('.optional-target', container);
        expect(found).toBe(child);
        const notFound = optionalElement('.optional-target', document.createElement('div'));
        expect(notFound).toBeNull();
      } finally {
        document.body.removeChild(container);
      }
    });
  });
});
