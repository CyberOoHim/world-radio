import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeSleepModal,
  isSleepModalOpen,
  openSleepModal,
  renderSleepModalHtml,
  toggleSleepModal,
} from './sleepModal';
import { sleepTimer } from './sleepTimer';

describe('sleepModal', () => {
  beforeEach(() => {
    closeSleepModal();
    sleepTimer.cancel();
  });

  it('starts closed and toggles open and closed', () => {
    expect(isSleepModalOpen()).toBe(false);
    expect(renderSleepModalHtml()).toBe('');

    openSleepModal();
    expect(isSleepModalOpen()).toBe(true);
    expect(renderSleepModalHtml()).toContain('Sleep Timer');

    closeSleepModal();
    expect(isSleepModalOpen()).toBe(false);
    expect(renderSleepModalHtml()).toBe('');

    toggleSleepModal();
    expect(isSleepModalOpen()).toBe(true);

    toggleSleepModal();
    expect(isSleepModalOpen()).toBe(false);
  });

  it('renders presets and custom form when timer is inactive', () => {
    openSleepModal();
    const html = renderSleepModalHtml();
    expect(html).toContain('data-action="sleep"');
    expect(html).toContain('data-min="15"');
    expect(html).toContain('data-min="30"');
    expect(html).toContain('data-min="60"');
    expect(html).toContain('sleep-custom-input');
    expect(html).toContain('data-action="sleep-custom-submit"');
    expect(html).toContain('data-action="close-sleep-modal"');
  });

  it('renders countdown, extend buttons, and cancel when timer is active', () => {
    sleepTimer.start(30);
    openSleepModal();
    const html = renderSleepModalHtml();

    expect(html).toContain('Sleep Timer Active');
    expect(html).toContain('sleep-active-time');
    expect(html).toContain('sleep-progress-bar');
    expect(html).toContain('data-action="sleep-extend"');
    expect(html).toContain('data-action="sleep-cancel"');
    expect(html).toContain('data-action="toggle-bedside-dim"');
  });
});
