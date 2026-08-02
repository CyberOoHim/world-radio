import { FX_PRESETS, type FxCategory } from './audioFx';
import { player } from './player';

let fxModalOpen = false;
let currentTab: FxCategory = 'Devices';

export function isFxModalOpen(): boolean {
  return fxModalOpen;
}

export function openFxModal(tab?: FxCategory) {
  fxModalOpen = true;
  if (tab) currentTab = tab;
  renderFxModal();
}

export function closeFxModal() {
  fxModalOpen = false;
  renderFxModal();
}

export function toggleFxModal() {
  fxModalOpen = !fxModalOpen;
  renderFxModal();
}

export function setFxModalTab(tab: FxCategory) {
  currentTab = tab;
  renderFxModal();
}

export function renderFxModalHtml(): string {
  if (!fxModalOpen) return '';

  const enabled = player.fxEnabled;
  const activePresetId = player.fxPresetId;
  const activePreset = FX_PRESETS.find((p) => p.id === activePresetId);

  const categories: { id: FxCategory; label: string; icon: string }[] = [
    { id: 'Devices', label: 'Devices', icon: '📻' },
    { id: 'Lo-Fi', label: 'Lo-Fi', icon: '📼' },
    { id: 'Spaces', label: 'Spaces', icon: '🏛️' },
  ];

  const presetsInTab = FX_PRESETS.filter((p) => p.cat === currentTab);

  return `
    <div class="fx-modal-backdrop" data-action="close-fx-modal"></div>
    <div class="fx-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="fx-modal-title">
      <div class="fx-modal-header">
        <div class="fx-modal-title-group">
          <div class="fx-modal-icon">🎙️</div>
          <div>
            <h2 id="fx-modal-title" class="fx-modal-title">Voice & Audio FX</h2>
            <p class="fx-modal-subtitle">Transform live radio with real-time vintage & room effects</p>
          </div>
        </div>
        <div class="fx-header-actions">
          <label class="fx-toggle-label" title="Enable or disable audio processing">
            <span class="fx-toggle-text">${enabled ? 'FX Active' : 'FX Off'}</span>
            <input type="checkbox" class="fx-toggle-input" data-action="toggle-fx" ${enabled ? 'checked' : ''} />
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

      ${
        enabled && activePreset
          ? `
        <div class="fx-status-banner">
          <span class="status-dot"></span>
          Current Mode: <strong>${activePreset.emoji} ${activePreset.name}</strong> (${activePreset.cat})
        </div>
      `
          : ''
      }

      <div class="fx-preset-grid">
        ${presetsInTab
          .map((p) => {
            const isSelected = activePresetId === p.id && enabled;
            return `
            <div
              class="fx-card ${isSelected ? 'is-selected' : ''}"
              data-action="select-fx-preset"
              data-id="${p.id}"
              tabindex="0"
              role="button"
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
            </div>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderFxModal() {
  const root = document.querySelector('.fx-modal-root');
  if (!root) return;
  root.innerHTML = renderFxModalHtml();
  document.body.classList.toggle('fx-modal-open', fxModalOpen);
}
