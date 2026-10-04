import { beforeEach, describe, expect, it } from 'vitest';
import {
  closePasscodeModal,
  getCurrentPasscodeValue,
  isPasscodeModalOpen,
  isPasscodeVisible,
  openPasscodeModal,
  renderPasscodeModalHtml,
  setCurrentPasscodeValue,
  togglePasscodeVisibility,
} from './passcodeModal';

describe('passcode modal visibility toggle', () => {
  beforeEach(() => {
    // Ensure document and body exist in test environment
    if (typeof document === 'undefined') {
      const elements = new Map<string, any>();
      (globalThis as any).document = {
        querySelector: (sel: string) => elements.get(sel) || null,
        createElement: (tag: string) => {
          const el = {
            tagName: tag.toUpperCase(),
            className: '',
            innerHTML: '',
            dataset: {},
            children: [],
            addEventListener: () => {},
            querySelector: () => null,
            querySelectorAll: () => [],
            setAttribute: () => {},
            getAttribute: () => null,
            classList: {
              toggle: () => {},
              add: () => {},
              remove: () => {},
              contains: () => false,
            },
          };
          return el;
        },
        body: {
          appendChild: () => {},
          classList: { toggle: () => {} },
        },
      };
    }
    closePasscodeModal();
  });

  it('defaults to invisible passcode (type=password) when opened', () => {
    openPasscodeModal();
    expect(isPasscodeModalOpen()).toBe(true);
    expect(isPasscodeVisible()).toBe(false);

    const html = renderPasscodeModalHtml();
    expect(html).toContain('type="password"');
    expect(html).not.toContain('type="text"');
    expect(html).toContain('aria-label="Show passcode"');
    expect(html).toContain('title="Show passcode"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-action="toggle-passcode-visibility"');
  });

  it('toggles to visible passcode (type=text) when toggled', () => {
    openPasscodeModal();
    expect(isPasscodeVisible()).toBe(false);

    togglePasscodeVisibility();
    expect(isPasscodeVisible()).toBe(true);

    const html = renderPasscodeModalHtml();
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Hide passcode"');
    expect(html).toContain('title="Hide passcode"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('is-active');

    // Toggle back to invisible
    togglePasscodeVisibility();
    expect(isPasscodeVisible()).toBe(false);

    const htmlHidden = renderPasscodeModalHtml();
    expect(htmlHidden).toContain('type="password"');
    expect(htmlHidden).toContain('aria-label="Show passcode"');
    expect(htmlHidden).toContain('title="Show passcode"');
    expect(htmlHidden).toContain('aria-pressed="false"');
    expect(htmlHidden).not.toContain('is-active');
  });

  it('resets to invisible by default when reopening the modal', () => {
    openPasscodeModal();
    togglePasscodeVisibility();
    expect(isPasscodeVisible()).toBe(true);

    // Close and reopen modal
    closePasscodeModal();
    expect(isPasscodeModalOpen()).toBe(false);

    openPasscodeModal();
    expect(isPasscodeModalOpen()).toBe(true);
    expect(isPasscodeVisible()).toBe(false);

    const html = renderPasscodeModalHtml();
    expect(html).toContain('type="password"');
  });

  it('preserves entered passcode value when toggling visibility', () => {
    openPasscodeModal();
    setCurrentPasscodeValue('secret-pass-2026');
    expect(getCurrentPasscodeValue()).toBe('secret-pass-2026');

    let html = renderPasscodeModalHtml();
    expect(html).toContain('value="secret-pass-2026"');

    togglePasscodeVisibility();
    expect(getCurrentPasscodeValue()).toBe('secret-pass-2026');

    html = renderPasscodeModalHtml();
    expect(html).toContain('value="secret-pass-2026"');
    expect(html).toContain('type="text"');
  });
});
