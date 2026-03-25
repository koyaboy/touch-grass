import { DEV_MODE, STORAGE_KEY } from "../config";
import type { RuntimeResponseMessage, StoredAppState } from "../types";
import { normalizeAppState } from "../utils/storage";
import { formatClockTime, formatDuration } from "../utils/time";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Settings root element was not found.");
}

const appRoot = app;

let appState: StoredAppState | null = null;
let liveTimerId: number | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function request(message: object): Promise<RuntimeResponseMessage> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponseMessage) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function renderLiveValues(): void {
  if (!appState) {
    return;
  }

  const countdown = document.querySelector("[data-role='settings-lock-countdown']");
  if (!(countdown instanceof HTMLElement)) {
    return;
  }

  const endsAt =
    appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt;

  if (endsAt) {
    countdown.textContent = formatDuration(endsAt - Date.now());
  }
}

function startLiveTicker(): void {
  if (liveTimerId) {
    window.clearInterval(liveTimerId);
  }

  liveTimerId = window.setInterval(renderLiveValues, 1000);
  renderLiveValues();
}

function render(): void {
  if (!appState) {
    return;
  }

  const mode = appState.recoveryState.mode;
  const settings = appState.settings;
  const lockEndsAt =
    appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt ?? 0;
  const isLocked = mode === "BREAK" || mode === "SHUTDOWN";
  const onboardingPending = !settings.onboardingCompleted;

  appRoot.innerHTML = `
    <main class="settings-page">
      <section class="settings-hero">
        <div class="settings-shell">
          <header class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p class="settings-kicker">Settings</p>
              <h1 class="settings-heading mt-3 text-4xl md:text-6xl">Shape the rhythm before you trust the lock.</h1>
              <p class="mt-5 max-w-2xl text-base leading-7 text-white/70 md:text-lg">Start with the essential session loop. Shutdown is optional and can stay off until you want a real end-of-day boundary.</p>
            </div>
            <a
              href="/newtab/index.html"
              class="settings-link"
            >
              Back to dashboard
            </a>
          </header>

          ${
            onboardingPending
              ? `
            <section class="settings-banner mt-8">
              <p class="settings-card-kicker">First run</p>
              <h2 class="mt-3 text-3xl text-white md:text-4xl">Complete the essentials to unlock session start.</h2>
              <p class="mt-4 max-w-3xl text-sm leading-6 text-white/72">Saving this form will finish onboarding. You only need work duration, break duration, and your basic preferences to begin. Shutdown stays optional.</p>
            </section>
          `
              : ""
          }

          <section class="settings-guide-grid mt-8">
            <article class="settings-guide-card">
              <p class="settings-card-kicker">1</p>
              <h2 class="mt-3 text-2xl text-white">Work until the timer ends</h2>
              <p class="mt-3 text-sm leading-6 text-white/70">Your session runs against the goal on the dashboard. No hidden complexity.</p>
            </article>
            <article class="settings-guide-card">
              <p class="settings-card-kicker">2</p>
              <h2 class="mt-3 text-2xl text-white">Break means actual break</h2>
              <p class="mt-3 text-sm leading-6 text-white/70">When work ends, the extension locks the break instead of politely asking.</p>
            </article>
            <article class="settings-guide-card">
              <p class="settings-card-kicker">3</p>
              <h2 class="mt-3 text-2xl text-white">Shutdown is a separate boundary</h2>
              <p class="mt-3 text-sm leading-6 text-white/70">Leave it blank to disable it. If you enable it, new sessions are blocked after that time until the next start time.</p>
            </article>
          </section>

          <form id="settings-form" class="mt-10 grid gap-5">
            <section class="settings-card">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="settings-card-kicker">Essential setup</p>
                  <h2 class="text-2xl text-white md:text-3xl">This is the minimum loop.</h2>
                </div>
                <span class="settings-chip">Required</span>
              </div>

              <div class="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
                <label class="settings-field">
                  <span>Work duration (minutes)</span>
                  <input name="workDurationMinutes" type="number" min="1" value="${settings.workDurationMinutes}" />
                  <small>How long you work before the extension forces a break.</small>
                </label>
                <label class="settings-field">
                  <span>Break duration (minutes)</span>
                  <input name="breakDurationMinutes" type="number" min="1" value="${settings.breakDurationMinutes}" />
                  <small>How long the break lock lasts before you can check in and continue.</small>
                </label>
                <label class="settings-field">
                  <span>Dashboard goal</span>
                  <input name="goal" type="text" value="${escapeHtml(settings.goal)}" />
                  <small>Optional. This is the goal shown when you start a session.</small>
                </label>
                <label class="settings-field">
                  <span>Early unlock phrase</span>
                  <input name="earlyUnlockPhrase" type="text" value="${escapeHtml(settings.earlyUnlockPhrase)}" />
                  <small>Only relevant when you allow yourself to unlock a break early by typing the phrase.</small>
                </label>
              </div>

              <label class="settings-toggle mt-5">
                <input name="soundEnabled" type="checkbox" ${settings.soundEnabled ? "checked" : ""} />
                <span>Sound enabled for session cues, break start/end, and break ambience</span>
              </label>
            </section>

            <section class="settings-card">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="settings-card-kicker">Advanced boundaries</p>
                  <h2 class="text-2xl text-white md:text-3xl">Optional daily cutoff</h2>
                </div>
                <span class="settings-chip settings-chip--muted">Optional</span>
              </div>

              <div class="settings-note mt-5">
                <p class="font-medium">How shutdown works</p>
                <p class="mt-2 text-sm leading-6 text-white/66">Leave hard shutdown blank to keep this disabled. If you turn it on, work start time becomes the time you can start again the next day.</p>
              </div>

              <div class="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
                <label class="settings-field">
                  <span>Hard shutdown time</span>
                  <input name="hardShutdownTime" type="time" value="${settings.hardShutdownTime}" />
                  <small>Optional nightly cutoff. After this time, new sessions are blocked.</small>
                </label>
                <label class="settings-field">
                  <span>Work start time</span>
                  <input name="workStartTime" type="time" value="${settings.workStartTime}" />
                  <small>The next time of day when work is allowed again. Only matters if shutdown is enabled.</small>
                </label>
              </div>
            </section>

            <section class="settings-note">
              <p class="font-medium">Developer mode</p>
              <p class="mt-2 text-sm leading-6 text-white/62">Toggle <code>DEV_MODE</code> in <code>src/config.ts</code>. Current build: <strong>${DEV_MODE ? "on" : "off"}</strong>.</p>
            </section>

            <div class="flex items-center justify-between gap-4">
              <p id="save-status" class="text-sm text-white/52">${onboardingPending ? "Saving here will complete onboarding and unlock your first session." : "Settings persist in chrome.storage.local."}</p>
              <button type="submit" class="settings-save">${onboardingPending ? "Save and finish setup" : "Save settings"}</button>
            </div>
          </form>
        </div>
      </section>

      ${
        isLocked
          ? `
        <div class="settings-lock">
          <section class="settings-lock-card settings-lock-card--${mode === "BREAK" ? "break" : "shutdown"}">
            <p class="text-xs uppercase tracking-[0.35em] text-white/80">${mode === "BREAK" ? "Mandatory break" : "Daily shutdown"}</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-tight">${mode === "BREAK" ? "bro step away from the keyboard" : "you're done for today"}</h2>
            <p class="mt-4 text-base text-white/85">${mode === "BREAK" ? "The lock follows you into settings too." : `Unlocked at ${formatClockTime(lockEndsAt)}.`}</p>
            <div class="mt-6 text-5xl font-semibold" data-role="settings-lock-countdown">${formatDuration(lockEndsAt - Date.now())}</div>
          </section>
        </div>
      `
          : ""
      }
    </main>
  `;

  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  const saveStatus = document.getElementById("save-status");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      goal: String(formData.get("goal") ?? ""),
      workDurationMinutes: Number(formData.get("workDurationMinutes") ?? 50),
      breakDurationMinutes: Number(formData.get("breakDurationMinutes") ?? 10),
      hardShutdownTime: String(formData.get("hardShutdownTime") ?? ""),
      workStartTime: String(formData.get("workStartTime") ?? "08:00"),
      earlyUnlockPhrase: String(formData.get("earlyUnlockPhrase") ?? "I took a break"),
      soundEnabled: formData.get("soundEnabled") === "on",
      onboardingCompleted: true,
    };

    const response = await request({ type: "UPDATE_SETTINGS", payload });
    if (saveStatus instanceof HTMLElement) {
      saveStatus.textContent = response.ok
        ? payload.onboardingCompleted && !settings.onboardingCompleted
          ? "Saved. Onboarding complete."
          : "Saved."
        : response.error;
    }
  });

  startLiveTicker();
}

function applyState(nextState: StoredAppState): void {
  appState = nextState;
  render();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  applyState(normalizeAppState(changes[STORAGE_KEY].newValue));
});

async function bootstrap(): Promise<void> {
  const response = await request({ type: "GET_APP_STATE" });

  if (!response.ok || !response.appState) {
    throw new Error(response.ok ? "Missing app state." : response.error);
  }

  applyState(response.appState);
}

void bootstrap();
