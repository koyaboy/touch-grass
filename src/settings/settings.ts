import { DEV_MODE, SOUND_FILES, STORAGE_KEY } from "../config";
import type { StoredAppState, RuntimeResponseMessage } from "../types";
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
    <main class="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <div class="settings-shell rounded-[36px] p-6 dark:border-white/10 dark:bg-white/5 md:p-8">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-white/48">Settings</p>
            <h1 class="settings-heading mt-3 text-4xl md:text-5xl">Choose when work stops and recovery starts.</h1>
          </div>
          <a
            href="/newtab/index.html"
            class="rounded-full border border-slate-300/70 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/70 dark:border-white/12 dark:text-white/74 dark:hover:bg-white/8"
          >
            Back to dashboard
          </a>
        </div>

        <form id="settings-form" class="mt-10 grid gap-6 md:grid-cols-2">
          <label class="grid gap-2">
            <span class="text-sm font-medium text-slate-700 dark:text-white/84">Work duration (minutes)</span>
            <input
              name="workDurationMinutes"
              type="number"
              min="1"
              class="rounded-2xl border border-slate-300/80 bg-white/70 px-4 py-3 text-base dark:border-white/10 dark:bg-white/6"
              value="${settings.workDurationMinutes}"
            />
          </label>

          <label class="grid gap-2">
            <span class="text-sm font-medium text-slate-700 dark:text-white/84">Break duration (minutes)</span>
            <input
              name="breakDurationMinutes"
              type="number"
              min="1"
              class="rounded-2xl border border-slate-300/80 bg-white/70 px-4 py-3 text-base dark:border-white/10 dark:bg-white/6"
              value="${settings.breakDurationMinutes}"
            />
          </label>

          <label class="grid gap-2">
            <span class="text-sm font-medium text-slate-700 dark:text-white/84">Hard shutdown time</span>
            <input
              name="hardShutdownTime"
              type="time"
              class="rounded-2xl border border-slate-300/80 bg-white/70 px-4 py-3 text-base dark:border-white/10 dark:bg-white/6"
              value="${settings.hardShutdownTime}"
            />
          </label>

          <label class="grid gap-2">
            <span class="text-sm font-medium text-slate-700 dark:text-white/84">Work start time</span>
            <input
              name="workStartTime"
              type="time"
              class="rounded-2xl border border-slate-300/80 bg-white/70 px-4 py-3 text-base dark:border-white/10 dark:bg-white/6"
              value="${settings.workStartTime}"
            />
          </label>

          <label class="grid gap-2 md:col-span-2">
            <span class="text-sm font-medium text-slate-700 dark:text-white/84">Goal text shown on the dashboard</span>
            <input
              name="goal"
              type="text"
              class="rounded-2xl border border-slate-300/80 bg-white/70 px-4 py-3 text-base dark:border-white/10 dark:bg-white/6"
              value="${escapeHtml(settings.goal)}"
            />
          </label>

          <div class="md:col-span-2 flex flex-col gap-4 rounded-[28px] border border-slate-200/80 bg-white/45 p-5 dark:border-white/10 dark:bg-white/6">
            <p class="text-sm font-medium">Developer mode</p>
            <p class="text-sm text-slate-600 dark:text-white/58">
              Toggle <code>DEV_MODE</code> in <code>src/config.ts</code> and rebuild. When enabled, work becomes 1 minute, break becomes 10 seconds, transitions log to the console, and overlays expose bypass controls.
            </p>
            <p class="text-sm text-slate-600 dark:text-white/58">Current build: <strong>${DEV_MODE ? "DEV_MODE on" : "DEV_MODE off"}</strong></p>
          </div>

          <div class="md:col-span-2 flex items-center justify-between gap-4">
            <p id="save-status" class="text-sm text-slate-500 dark:text-white/50">Settings are stored in chrome.storage.local.</p>
            <button
              type="submit"
              class="rounded-full bg-slate-950 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-white/88"
            >
              Save settings
            </button>
          </div>
        </form>
      </div>

      ${
        isLocked
          ? `
        <div class="settings-lock">
          <section class="settings-lock-card settings-lock-card--${mode === "BREAK" ? "break" : "shutdown"}">
            <p class="text-xs uppercase tracking-[0.35em] text-white/80">${mode === "BREAK" ? "Mandatory break" : "Daily shutdown"}</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-tight">${mode === "BREAK" ? "bro step away from the keyboard" : "you're done for today"}</h2>
            <p class="mt-4 text-base text-white/85">
              ${mode === "BREAK" ? "The lock follows you across the extension too." : `Unlocked at ${formatClockTime(lockEndsAt)}.`}
            </p>
            <div class="mt-6 text-5xl font-semibold" data-role="settings-lock-countdown">${formatDuration(lockEndsAt - Date.now())}</div>
            ${
              DEV_MODE
                ? `
              <button
                id="settings-dev-bypass"
                class="mt-6 rounded-full bg-red-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-400"
              >
                DEV BYPASS — skip break
              </button>
            `
                : ""
            }
          </section>
        </div>
      `
          : ""
      }
    </main>
  `;

  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  const saveStatus = document.getElementById("save-status");
  const devBypass = document.getElementById("settings-dev-bypass");

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
      saveStatus.textContent = response.ok
        ? "Saved. Daily alarms were rescheduled."
        : response.error;
    }
  });

  devBypass?.addEventListener("click", () => {
    void request({ type: "DISMISS_OVERLAY_DEV" });
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
