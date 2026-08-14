import { FX_PRESETS, type FxCategory } from './audioFx';
import { EQ_PRESETS, type EqBands } from './equalizer';
import { escapeHtml } from './html';
import { isAppleTouchDevice, player } from './player';

export type ModalTab = FxCategory | 'Equalizer';

let fxModalOpen = false;
let currentTab: ModalTab = 'Devices';

export function isFxModalOpen(): boolean {
  return fxModalOpen;
}

export function openFxModal(tab?: ModalTab) {
  if (isAppleTouchDevice()) {
    player.notifyCustomNotice('Audio FX & EQ could not be applied on iPhone and iPad.');
    return;
  }
  fxModalOpen = true;
  if (tab) currentTab = tab;
  renderFxModal();
}

export function closeFxModal() {
  fxModalOpen = false;
  renderFxModal();
  document.querySelector<HTMLElement>('[data-action="toggle-fx-modal"]')?.focus();
}

export function toggleFxModal() {
  if (isAppleTouchDevice()) {
    player.notifyCustomNotice('Audio FX & EQ could not be applied on iPhone and iPad.');
    return;
  }
  fxModalOpen = !fxModalOpen;
  renderFxModal();
}

export function setFxModalTab(tab: ModalTab) {
  currentTab = tab;
  renderFxModal();
}

function renderEqSectionHtml(): string {
  const eqEnabled = player.eqEnabled;
  const eqPresetId = player.eqPresetId;
  const bands = player.eqBands;
  const customPresets = player.customEqPresets;

  const bandConfigs: { key: keyof EqBands; label: string; sub: string }[] = [
    { key: 'b60', label: '60 Hz', sub: 'Sub-Bass' },
    { key: 'b150', label: '150 Hz', sub: 'Warmth' },
    { key: 'b400', label: '400 Hz', sub: 'Mud Cut' },
    { key: 'b1k', label: '1 kHz', sub: 'Mid Core' },
    { key: 'b2k5', label: '2.5 kHz', sub: 'Clarity' },
    { key: 'b6k', label: '6 kHz', sub: 'Presence' },
    { key: 'b10k', label: '10 kHz', sub: 'Hiss Cut' },
    { key: 'b16k', label: '16 kHz', sub: 'Air' },
  ];

  return `
    <div class="eq-panel">
      <div class="eq-preset-row">
        <span class="eq-preset-label">Default Presets:</span>
        <div class="eq-presets-wrap">
          ${EQ_PRESETS.map(
            (p) => `
            <button
              type="button"
              class="chip eq-preset-chip ${eqPresetId === p.id && eqEnabled ? 'active' : ''}"
              data-action="select-eq-preset"
              data-id="${p.id}"
            >
              ${p.emoji} ${p.name}
            </button>
          `
          ).join('')}
        </div>
      </div>

      ${
        customPresets.length > 0
          ? `
        <div class="eq-preset-row">
          <span class="eq-preset-label">My Saved Presets:</span>
          <div class="eq-presets-wrap">
            ${customPresets
              .map(
                (cp) => `
              <div class="chip eq-custom-chip ${eqPresetId === cp.id && eqEnabled ? 'active' : ''}">
                <button
                  type="button"
                  class="eq-chip-btn"
                  data-action="select-eq-preset"
                  data-id="${cp.id}"
                >
                  ⭐ ${escapeHtml(cp.name)}
                </button>
                <button
                  type="button"
                  class="eq-chip-del"
                  data-action="delete-custom-eq"
                  data-id="${escapeHtml(cp.id)}"
                  title="Delete preset ${escapeHtml(cp.name)}"
                  aria-label="Delete preset ${escapeHtml(cp.name)}"
                >
                  ✕
                </button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
          : ''
      }

      <div class="eq-save-row">
        <input
          type="text"
          class="eq-save-input"
          placeholder="Preset name (e.g. My Late Night Radio)..."
          id="eq-preset-name-input"
        />
        <button
          type="button"
          class="btn-sm btn-primary eq-save-btn"
          data-action="save-custom-eq"
        >
          💾 Save Preset
        </button>
        <button
          type="button"
          class="btn-sm eq-reset-btn"
          data-action="reset-eq"
          title="Reset all 8 bands to Flat (0 dB)"
        >
          ↺ Reset EQ
        </button>
      </div>

      <div class="eq-sliders-container ${!eqEnabled ? 'is-disabled' : ''}">
        ${bandConfigs
          .map((b) => {
            const val = bands[b.key] || 0;
            const formatted = (val > 0 ? '+' : '') + val + ' dB';
            return `
            <div class="eq-slider-col">
              <div class="eq-db-val">${formatted}</div>
              <div class="eq-track-wrap">
                <input
                  type="range"
                  class="eq-v-slider"
                  min="-12"
                  max="12"
                  step="1"
                  value="${val}"
                  data-action="change-eq-band"
                  data-band="${b.key}"
                  aria-label="${b.label} Equalizer Band"
                  ${!eqEnabled ? 'disabled' : ''}
                />
              </div>
              <div class="eq-band-title">${b.label}</div>
              <div class="eq-band-sub">${b.sub}</div>
            </div>
          `;
          })
          .join('')}
      </div>

      <div class="eq-guide-box">
        <div class="eq-guide-title">💡 Frequency Adjustment Guide</div>
        <table class="eq-guide-table">
          <thead>
            <tr>
              <th>Frequency</th>
              <th>Target</th>
              <th>Radio Tuning Tip</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>60 Hz</strong></td><td>Sub-Bass</td><td>Boost for electronic music; cut for HVAC room rumble</td></tr>
            <tr><td><strong>150 Hz</strong></td><td>Bass Warmth</td><td>Adds warmth to male announcers & bass instruments</td></tr>
            <tr><td><strong>400 Hz</strong></td><td>Low-Mid (Mud)</td><td><strong>Cut (-2 to -4dB)</strong> to clear boxy radio streams</td></tr>
            <tr><td><strong>1 kHz</strong></td><td>Vocal Core</td><td>Body of human voice & main instruments</td></tr>
            <tr><td><strong>2.5 kHz</strong></td><td>Speech Clarity</td><td><strong>Boost (+2 to +4dB)</strong> for clear news anchors</td></tr>
            <tr><td><strong>6 kHz</strong></td><td>Presence</td><td>Adjust vocal crispness & microphone sibilance</td></tr>
            <tr><td><strong>10 kHz</strong></td><td>Treble / Hiss</td><td><strong>Cut (-3 to -6dB)</strong> to silence static noise</td></tr>
            <tr><td><strong>16 kHz</strong></td><td>Super Air</td><td>Adds sparkle and air sheen to HD broadcasts</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderFxModalHtml(): string {
  if (!fxModalOpen) return '';

  const isEqTab = currentTab === 'Equalizer';
  const isEnabled = isEqTab ? player.eqEnabled : player.fxEnabled;

  const categories: { id: ModalTab; label: string; icon: string }[] = [
    { id: 'Devices', label: 'Devices', icon: '📻' },
    { id: 'Lo-Fi', label: 'Lo-Fi', icon: '📼' },
    { id: 'Spaces', label: 'Spaces', icon: '🏛️' },
    { id: 'Equalizer', label: 'Equalizer', icon: '🎚️' },
  ];

  const presetsInTab = isEqTab ? [] : FX_PRESETS.filter((p) => p.cat === currentTab);
  const activeFxPreset = FX_PRESETS.find((p) => p.id === player.fxPresetId);

  return `
    <div class="fx-modal-backdrop" data-action="close-fx-modal"></div>
    <div class="fx-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="fx-modal-title">
      <div class="fx-modal-header">
        <div class="fx-modal-title-group">
          <div class="fx-modal-icon">🎛️</div>
          <div>
            <h2 id="fx-modal-title" class="fx-modal-title">${isEqTab ? '8-Band Graphic Equalizer' : 'Voice & Audio FX'}</h2>
            <p class="fx-modal-subtitle">${
              isEqTab
                ? '8-band precision frequency shaping & radio tuning guide'
                : 'Transform live radio with real-time vintage & room effects'
            }</p>
          </div>
        </div>
        <div class="fx-header-actions">
          <label class="fx-toggle-label" title="${isEqTab ? 'Enable or disable Equalizer' : 'Enable or disable Voice FX'}">
            <span class="fx-toggle-text">${isEnabled ? (isEqTab ? 'EQ Active' : 'FX Active') : (isEqTab ? 'EQ Off' : 'FX Off')}</span>
            <input type="checkbox" class="fx-toggle-input" data-action="${isEqTab ? 'toggle-eq' : 'toggle-fx'}" ${isEnabled ? 'checked' : ''} />
            <span class="fx-toggle-slider"></span>
          </label>
          <button type="button" class="btn-icon close-btn" data-action="close-fx-modal" aria-label="Close modal">✕</button>
        </div>
      </div>

      <div class="fx-tabs" role="tablist">
        ${categories
          .map(
            (cat) => `
          <button
            type="button"
            role="tab"
            class="fx-tab-btn ${currentTab === cat.id ? 'active' : ''}"
            data-action="select-fx-tab"
            data-tab="${cat.id}"
            aria-selected="${currentTab === cat.id}"
          >
            <span>${cat.icon}</span> ${cat.label}
          </button>
        `
          )
          .join('')}
      </div>

      <div class="fx-modal-scroll-body">
        ${
          !isEqTab && player.fxEnabled && activeFxPreset
            ? `
          <div class="fx-status-banner">
            <span class="status-dot"></span>
            Voice FX Mode: <strong>${activeFxPreset.emoji} ${activeFxPreset.name}</strong> (${activeFxPreset.cat})
          </div>
        `
            : ''
        }

        ${
          isEqTab && player.eqEnabled
            ? `
          <div class="fx-status-banner">
            <span class="status-dot"></span>
            Equalizer Active: <strong>${player.eqPresetId.toUpperCase()} Mode</strong>
          </div>
        `
            : ''
        }

        ${isEqTab ? renderEqSectionHtml() : `
          <div class="fx-preset-grid">
            ${presetsInTab
              .map((p) => {
                const isSelected = player.fxPresetId === p.id && player.fxEnabled;
                return `
                <button
                  type="button"
                  class="fx-card ${isSelected ? 'is-selected' : ''}"
                  data-action="select-fx-preset"
                  data-id="${p.id}"
                >
                  <div class="fx-card-header">
                    <span class="fx-card-emoji">${p.emoji}</span>
                    <div class="fx-card-titles">
                      <div class="fx-card-name">${p.name}</div>
                      ${p.era ? `<div class="fx-card-era">${p.era}</div>` : ''}
                    </div>
                    ${isSelected ? `<span class="fx-card-badge">ACTIVE</span>` : ''}
                  </div>
                  <div class="fx-card-desc">${p.desc}</div>
                </button>
              `;
              })
              .join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function focusableIn(root: Element): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
}

function onFxModalKeydown(e: KeyboardEvent) {
  if (!fxModalOpen) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeFxModal();
    const trigger = document.querySelector<HTMLElement>('[data-action="toggle-fx-modal"]');
    trigger?.focus();
    return;
  }
  if (e.key !== 'Tab') return;
  const dialog = document.querySelector('.fx-modal-dialog');
  if (!dialog) return;
  const items = focusableIn(dialog);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (active && !dialog.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

let fxKeyBound = false;

export function renderFxModal() {
  const root = document.querySelector('.fx-modal-root');
  if (!root) return;
  const eqSlider = document.activeElement;
  const keepEq =
    eqSlider instanceof HTMLInputElement &&
    eqSlider.classList.contains('eq-v-slider') &&
    fxModalOpen;
  const keepBand = keepEq ? eqSlider.dataset.band : null;
  const keepVal = keepEq ? eqSlider.value : null;

  root.innerHTML = renderFxModalHtml();
  document.body.classList.toggle('fx-modal-open', fxModalOpen);

  if (!fxKeyBound) {
    fxKeyBound = true;
    document.addEventListener('keydown', onFxModalKeydown, true);
  }

  if (!fxModalOpen) return;

  if (keepBand) {
    const slider = root.querySelector<HTMLInputElement>(`.eq-v-slider[data-band="${keepBand}"]`);
    if (slider) {
      if (keepVal != null) slider.value = keepVal;
      slider.focus();
    }
  } else {
    const closeBtn = root.querySelector<HTMLElement>('.fx-modal-dialog .close-btn');
    closeBtn?.focus();
  }
}
