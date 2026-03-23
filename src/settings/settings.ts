import { DEV_MODE, SOUND_FILES, STORAGE_KEY } from "../config";
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
let lastMode = "IDLE";

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

function playSound(path: string): void {
  const audio = new Audio(chrome.runtime.getURL(path));
  void audio.play().catch(() => undefined);
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

  appRoot.innerHTML = `
    <main class="settings-page">
      <section class="settings-hero">
        <div class="settings-shell">
          <header class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p class="settings-kicker">Settings</p>
              <h1 class="settings-heading mt-3 text-4xl md:text-6xl">Shape the rhythm, not just the timer.</h1>
              <p class="mt-5 max-w-2xl text-base leading-7 text-white/70 md:text-lg">Tune work, breaks, shutdown, and start time so the lock fits how you actually work.</p>
            </div>
            <a
              href="/newtab/index.html"
              class="settings-link"
            >
              Back to dashboard
            </a>
          </header>

          <form id="settings-form" class="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
            <section class="settings-card">
              <p class="settings-card-kicker">Sessions</p>
              <label class="settings-field">
                <span>Work duration (minutes)</span>
                <input name="workDurationMinutes" type="number" min="1" value="${settings.workDurationMinutes}" />
              </label>
              <label class="settings-field">
                <span>Break duration (minutes)</span>
                <input name="breakDurationMinutes" type="number" min="1" value="${settings.breakDurationMinutes}" />
              </label>
              <label class="settings-field">
                <span>Goal shown on dashboard</span>
                <input name="goal" type="text" value="${escapeHtml(settings.goal)}" />
              </label>
            </section>

            <section class="settings-card">
              <p class="settings-card-kicker">Boundaries</p>
              <label class="settings-field">
                <span>Hard shutdown time</span>
                <input name="hardShutdownTime" type="time" value="${settings.hardShutdownTime}" />
              </label>
              <label class="settings-field">
                <span>Work start time</span>
                <input name="workStartTime" type="time" value="${settings.workStartTime}" />
              </label>
              <div class="settings-note">
                <p class="font-medium">Developer mode</p>
                <p class="mt-2 text-sm leading-6 text-white/62">Toggle <code>DEV_MODE</code> in <code>src/config.ts</code>. Current build: <strong>${DEV_MODE ? "on" : "off"}</strong>.</p>
              </div>
            </section>

            <div class="lg:col-span-2 flex items-center justify-between gap-4">
              <p id="save-status" class="text-sm text-white/52">Settings persist in chrome.storage.local.</p>
              <button type="submit" class="settings-save">Save settings</button>
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
      hardShutdownTime: String(formData.get("hardShutdownTime") ?? "22:00"),
      workStartTime: String(formData.get("workStartTime") ?? "08:00"),
    };

    const response = await request({ type: "UPDATE_SETTINGS", payload });
    if (saveStatus instanceof HTMLElement) {
      saveStatus.textContent = response.ok ? "Saved." : response.error;
    }
  });

  startLiveTicker();
}

function applyState(nextState: StoredAppState): void {
  const previousMode = lastMode;
  appState = nextState;
  lastMode = nextState.recoveryState.mode;
  render();

  if (previousMode !== nextState.recoveryState.mode && nextState.recoveryState.mode === "SHUTDOWN") {
    playSound(SOUND_FILES.shutdown);
  }
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
