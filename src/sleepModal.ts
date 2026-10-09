import { escapeHtml } from './html';
import { formatSleepRemaining, sleepTimer } from './sleepTimer';
import type { SleepMinutes } from './types';

let isOpen = false;

export const SLEEP_OPTIONS: SleepMinutes[] = [15, 30, 45, 60, 90, 120];

export function isSleepModalOpen(): boolean {
  return isOpen;
}

export function openSleepModal(): void {
  isOpen = true;
  renderSleepModal();
  if (typeof document !== 'undefined') {
    setTimeout(() => {
      const root = document.querySelector('.sleep-modal-root');
      const input = root?.querySelector<HTMLInputElement>('.sleep-custom-input');
      const firstBtn = root?.querySelector<HTMLButtonElement>(
        '.sleep-opt, .sleep-extend-btn, .sleep-modal-close'
      );
      (input || firstBtn)?.focus();
    }, 40);
  }
}

export function closeSleepModal(): void {
  isOpen = false;
  renderSleepModal();
}

export function toggleSleepModal(): void {
  if (isOpen) {
    closeSleepModal();
  } else {
    openSleepModal();
  }
}

export function renderSleepModalHtml(): string {
  if (!isOpen) return '';

  const active = sleepTimer.active;
  const remaining = sleepTimer.remainingMs;
  const label = formatSleepRemaining(remaining);
  const progressPercent = (sleepTimer.progress * 100).toFixed(1);

  return `
    <div class="sleep-modal-backdrop" data-action="close-sleep-modal" aria-hidden="true"></div>
    <div class="sleep-modal-container" role="dialog" aria-modal="true" aria-labelledby="sleep-modal-title">
      <div class="sleep-modal-card">
        <div class="sleep-modal-header">
          <div class="sleep-modal-title-wrap">
            <span class="sleep-modal-icon" aria-hidden="true">🌙</span>
            <div>
              <h2 id="sleep-modal-title" class="sleep-modal-title">${active ? 'Sleep Timer Active' : 'Sleep Timer'}</h2>
              <div class="sleep-modal-subtitle">${active ? 'Playback will stop when time expires' : 'Drift off & save device battery'}</div>
            </div>
            ${active ? `<span class="sleep-modal-badge is-active">Active</span>` : ''}
          </div>
          <button type="button" class="btn-icon sleep-modal-close" data-action="close-sleep-modal" aria-label="Close sleep timer dialog" title="Close (Esc)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" width="18" height="18"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div class="sleep-modal-body">
          ${
            active
              ? `
                <div class="sleep-active-box">
                  <div class="sleep-active-time">${escapeHtml(label || '0:00')}</div>
                  <div class="sleep-active-label">remaining until music stops</div>
                  <div class="sleep-progress-track" aria-hidden="true">
                    <div class="sleep-progress-bar" style="width: ${progressPercent}%"></div>
                  </div>
                </div>

                <div class="sleep-section-title">Extend countdown</div>
                <div class="sleep-extend-row">
                  <button type="button" class="sleep-extend-btn" data-action="sleep-extend" data-min="5" title="Add 5 minutes">+5 min</button>
                  <button type="button" class="sleep-extend-btn" data-action="sleep-extend" data-min="15" title="Add 15 minutes">+15 min</button>
                  <button type="button" class="sleep-extend-btn" data-action="sleep-extend" data-min="30" title="Add 30 minutes">+30 min</button>
                </div>

                <div class="sleep-actions-row">
                  <button type="button" class="sleep-action-btn dim-btn" data-action="toggle-bedside-dim" title="OLED & battery-saving night clock">
                    ${sleepTimer.isDim ? '☀️ Exit Bedside Dim' : '🌙 Bedside Dim Clock'}
                  </button>
                  <button type="button" class="sleep-action-btn cancel-btn" data-action="sleep-cancel" title="Cancel sleep timer">
                    Cancel Timer
                  </button>
                </div>

                <div class="sleep-ipad-note">
                  ⚡ <strong>Battery Safeguard:</strong> Stream socket disconnects and audio hardware powers down automatically to preserve battery.
                </div>
              `
              : `
                <p class="sleep-modal-desc">
                  Select a duration and World Radio will gently fade out and stop playback when the timer finishes so you can rest peacefully.
                </p>

                <div class="sleep-section-title">Quick presets</div>
                <div class="sleep-grid">
                  ${SLEEP_OPTIONS.map(
                    (m) => `
                    <button type="button" class="sleep-opt" data-action="sleep" data-min="${m}" title="Start ${m} minute sleep timer">
                      <strong>${m}</strong>
                      <span>min</span>
                    </button>
                  `
                  ).join('')}
                </div>

                <div class="sleep-section-title">Custom minutes</div>
                <form class="sleep-custom-row" data-action="sleep-custom-form">
                  <input
                    type="number"
                    class="sleep-custom-input"
                    min="1"
                    max="480"
                    placeholder="Enter minutes (1–480)"
                    aria-label="Custom sleep duration in minutes"
                  />
                  <button type="submit" class="sleep-custom-btn" data-action="sleep-custom-submit">Start Timer</button>
                </form>

                <div class="sleep-section-title">Night display</div>
                <button type="button" class="sleep-action-btn dim-btn dim-btn-full" data-action="toggle-bedside-dim" title="Full screen OLED dim clock">
                  🌙 Bedside Dim Clock Mode
                </button>

                <div class="sleep-ipad-note">
                  🔋 <strong>Zero Standby Drain:</strong> Stream socket closes and audio engine powers down on timer completion.
                </div>
              `
          }
        </div>
      </div>
    </div>
  `;
}

export function renderSleepModal(): void {
  if (typeof document === 'undefined') return;
  let root = document.querySelector('.sleep-modal-root');
  if (!root) {
    const app = document.querySelector('#app');
    root = document.createElement('div');
    root.className = 'sleep-modal-root';
    if (app) {
      app.appendChild(root);
    } else {
      document.body.appendChild(root);
    }
  }

  root.innerHTML = renderSleepModalHtml();
  document.body.classList.toggle('sleep-modal-open', isOpen);
}
