import { getAuthState, logoutPasscode, verifyPasscode } from './auth';
import { escapeHtml } from './html';

let isOpen = false;
let isSubmitting = false;
let errorMessage = '';
let showPasscode = false;
let currentPasscode = '';
let copiedToken = false;
let onAuthSuccessCallback: (() => void) | null = null;

const ICON_EYE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function isPasscodeModalOpen(): boolean {
  return isOpen;
}

export function isPasscodeVisible(): boolean {
  return showPasscode;
}

export function getCurrentPasscodeValue(): string {
  return currentPasscode;
}

export function setCurrentPasscodeValue(val: string): void {
  currentPasscode = val;
}

export function openPasscodeModal(onSuccess?: () => void): void {
  isOpen = true;
  errorMessage = '';
  isSubmitting = false;
  showPasscode = false; // Default invisible
  currentPasscode = '';
  copiedToken = false;
  if (onSuccess) onAuthSuccessCallback = onSuccess;
  renderPasscodeModal();

  setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('.passcode-input');
    input?.focus();
  }, 50);
}

export function closePasscodeModal(): void {
  isOpen = false;
  errorMessage = '';
  isSubmitting = false;
  showPasscode = false; // Reset to default invisible
  currentPasscode = '';
  copiedToken = false;
  renderPasscodeModal();
}

export async function copyJwtToken(): Promise<boolean> {
  const { token } = getAuthState();
  if (!token) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(token);
    } else {
      const textarea = document.querySelector<HTMLTextAreaElement>('.auth-token-textarea');
      if (textarea) {
        textarea.select();
        document.execCommand('copy');
      }
    }
    copiedToken = true;
    renderPasscodeModal();
    setTimeout(() => {
      copiedToken = false;
      renderPasscodeModal();
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

export function renderPasscodeModalHtml(): string {
  if (!isOpen) return '';

  const { authenticated, token } = getAuthState();

  return `
    <div class="auth-modal-backdrop" data-action="close-auth-modal" aria-hidden="true"></div>
    <div class="auth-modal-container" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div class="auth-modal-card">
        <div class="auth-modal-header">
          <div class="auth-modal-badge ${authenticated ? 'is-authenticated' : 'is-locked'}">
            <span class="auth-badge-dot"></span>
            <span>${authenticated ? 'Authenticated (JWT Active)' : 'Passcode Required'}</span>
          </div>
          <button type="button" class="btn-icon auth-modal-close" data-action="close-auth-modal" aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" width="18" height="18"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div class="auth-modal-body">
          <h2 id="auth-modal-title" class="auth-modal-title">
            ${authenticated ? 'Backend Access Granted' : 'Backend Passcode Access'}
          </h2>
          <p class="auth-modal-desc">
            ${
              authenticated
                ? 'Your session is securely authenticated with the backend via signed JWT. All backend proxy routes and tile services are active.'
                : 'Enter the access passcode to verify your session with the backend and unlock map tile proxying and backend services.'
            }
          </p>

          ${
            errorMessage
              ? `<div class="auth-alert is-error" role="alert"><span class="auth-alert-icon">⚠️</span><span>${errorMessage}</span></div>`
              : ''
          }

          ${
            authenticated
              ? `
            <div class="auth-info-card">
              <div class="auth-info-row">
                <span class="auth-info-label">Status:</span>
                <span class="auth-info-value is-green">● Connected &amp; Authorized</span>
              </div>

              <div class="auth-token-box">
                <div class="auth-token-box-header">
                  <span class="auth-info-label">Active JWT String:</span>
                  <button type="button" class="auth-copy-token-btn ${copiedToken ? 'is-copied' : ''}" data-action="copy-jwt-token" title="Copy full JWT string to clipboard">
                    ${copiedToken ? '✓ Copied!' : '📋 Copy JWT'}
                  </button>
                </div>
                <textarea class="auth-token-textarea" readonly rows="3" aria-label="Full JWT token string" spellcheck="false">${escapeHtml(token || '')}</textarea>
              </div>

              <div class="auth-info-row">
                <span class="auth-info-label">Backend Proxy:</span>
                <span class="auth-info-value">Protected (/api/*)</span>
              </div>
            </div>

            <div class="auth-modal-actions">
              <button type="button" class="btn-secondary auth-logout-btn" data-action="auth-logout">
                Log Out
              </button>
              <button type="button" class="btn-primary" data-action="close-auth-modal">
                Done
              </button>
            </div>
            `
              : `
            <form class="auth-form" data-action="submit-passcode">
              <div class="auth-input-group">
                <label for="passcode-input" class="auth-input-label">Access Passcode</label>
                <div class="auth-input-wrapper">
                  <input
                    id="passcode-input"
                    type="${showPasscode ? 'text' : 'password'}"
                    class="auth-input passcode-input"
                    value="${escapeHtml(currentPasscode)}"
                    placeholder="Enter passcode (e.g. radio-2026)"
                    autocomplete="current-password"
                    required
                    ${isSubmitting ? 'disabled' : ''}
                  />
                  <button
                    type="button"
                    class="auth-toggle-visibility ${showPasscode ? 'is-active' : ''}"
                    data-action="toggle-passcode-visibility"
                    aria-label="${showPasscode ? 'Hide passcode' : 'Show passcode'}"
                    aria-pressed="${showPasscode ? 'true' : 'false'}"
                    title="${showPasscode ? 'Hide passcode' : 'Show passcode'}"
                  >
                    ${showPasscode ? ICON_EYE_OFF : ICON_EYE}
                  </button>
                </div>
                <div class="auth-hint">Default development passcode: <code>radio-2026</code> (configured via <code>APP_PASSCODE</code>)</div>
              </div>

              <div class="auth-modal-actions">
                <button type="button" class="btn-secondary" data-action="close-auth-modal" ${isSubmitting ? 'disabled' : ''}>
                  Cancel
                </button>
                <button type="submit" class="btn-primary auth-submit-btn" ${isSubmitting ? 'disabled' : ''}>
                  ${isSubmitting ? '<span class="auth-spinner"></span> Verifying…' : 'Verify &amp; Unlock'}
                </button>
              </div>
            </form>
            `
          }
        </div>
      </div>
    </div>
  `;
}

export function renderPasscodeModal(): void {
  let root = document.querySelector('.auth-modal-root');
  if (!root) {
    const app = document.querySelector('#app');
    root = document.createElement('div');
    root.className = 'auth-modal-root';
    if (app) {
      app.appendChild(root);
    } else {
      document.body.appendChild(root);
    }
  }
  root.innerHTML = renderPasscodeModalHtml();
  document.body.classList.toggle('auth-modal-open', isOpen);

  const input = root.querySelector<HTMLInputElement>('.passcode-input');
  if (input) {
    input.addEventListener('input', () => {
      currentPasscode = input.value;
    });
  }
}

export async function handlePasscodeSubmit(form: HTMLFormElement): Promise<void> {
  const input = form.querySelector<HTMLInputElement>('.passcode-input');
  if (!input) return;

  const code = input.value.trim();
  currentPasscode = input.value;
  if (!code) {
    errorMessage = 'Please enter a passcode.';
    renderPasscodeModal();
    return;
  }

  isSubmitting = true;
  errorMessage = '';
  renderPasscodeModal();

  const res = await verifyPasscode(code);
  isSubmitting = false;

  if (res.success) {
    currentPasscode = '';
    showPasscode = false;
    if (onAuthSuccessCallback) {
      onAuthSuccessCallback();
      onAuthSuccessCallback = null;
    }
    renderPasscodeModal();
  } else {
    errorMessage = res.error || 'Incorrect passcode. Please try again.';
    renderPasscodeModal();
    const nextInput = document.querySelector<HTMLInputElement>('.passcode-input');
    nextInput?.focus();
    nextInput?.select();
  }
}

export async function handleLogout(): Promise<void> {
  await logoutPasscode();
  renderPasscodeModal();
}

export function togglePasscodeVisibility(): void {
  showPasscode = !showPasscode;
  const input = document.querySelector<HTMLInputElement>('.passcode-input');
  const btn = document.querySelector<HTMLButtonElement>('.auth-toggle-visibility');

  if (input && btn) {
    const val = input.value;
    currentPasscode = val;
    input.type = showPasscode ? 'text' : 'password';
    input.value = val;

    btn.setAttribute('aria-label', showPasscode ? 'Hide passcode' : 'Show passcode');
    btn.setAttribute('title', showPasscode ? 'Hide passcode' : 'Show passcode');
    btn.setAttribute('aria-pressed', showPasscode ? 'true' : 'false');
    btn.classList.toggle('is-active', showPasscode);
    btn.innerHTML = showPasscode ? ICON_EYE_OFF : ICON_EYE;

    if (document.activeElement !== btn) {
      input.focus();
      try {
        const len = val.length;
        input.setSelectionRange(len, len);
      } catch {
        // ignore
      }
    }
  } else {
    renderPasscodeModal();
  }
}
