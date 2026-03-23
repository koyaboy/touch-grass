import { DEV_MODE, SOUND_FILES, STORAGE_KEY } from "../config";
import type { StoredAppState, RuntimeResponseMessage } from "../types";
import { getTodaySessionHistory, normalizeAppState } from "../utils/storage";
import { formatClockTime, formatDuration, formatMinutes } from "../utils/time";

const app = document.getElementById("app");

if (!app) {
  throw new Error("New tab root element was not found.");
}

const appRoot = app;

let appState: StoredAppState | null = null;
let liveTimerId: number | null = null;
let goalDraft = "";
let lastMode = "IDLE";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function playSound(path: string): void {
  if (!path) {
    return;
  }

  const audio = new Audio(chrome.runtime.getURL(path));
  void audio.play().catch(() => undefined);
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

  const workingCountdown = document.querySelector("[data-role='working-countdown']");
  if (workingCountdown instanceof HTMLElement && appState.recoveryState.activeSession) {
    workingCountdown.textContent = formatDuration(
      appState.recoveryState.activeSession.endsAt - Date.now(),
    );
  }

  const lockCountdown = document.querySelector("[data-role='lock-countdown']");
  if (lockCountdown instanceof HTMLElement) {
    const endsAt =
      appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt;
    if (endsAt) {
      lockCountdown.textContent = formatDuration(endsAt - Date.now());
    }
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

  const todaySessions = getTodaySessionHistory(appState.sessionHistory);
  const totalFocusMinutes = todaySessions.reduce(
    (sum, session) => sum + session.workDurationMinutes,
    0,
  );
  const mode = appState.recoveryState.mode;
  const activeSession = appState.recoveryState.activeSession;
  const lockEndsAt =
    appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt ?? 0;
  const isLocked = mode === "BREAK" || mode === "SHUTDOWN";

  appRoot.innerHTML = `
    <main class="tg-shell">
      <div class="tg-layout grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <section class="tg-panel rounded-[32px] p-6 md:p-8">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Touch Grass</p>
              <h1 class="tg-heading mt-3 text-4xl md:text-6xl">Recovery enforcement for deep work.</h1>
            </div>
            <a
              href="/settings/index.html"
              class="rounded-full border border-slate-300/70 px-4 py-2 text-sm text-slate-600 transition hover:bg-white/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/40"
              aria-label="Open settings"
            >
              Settings
            </a>
          </div>

          <div class="mt-10 rounded-[28px] border border-slate-200/70 bg-white/65 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
            <p class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Goal for the day</p>
            <input
              id="goal-input"
              class="tg-goal-input tg-heading mt-3 text-3xl md:text-5xl"
              value="${escapeHtml(goalDraft)}"
              placeholder="Write one sentence that matters today"
            />
          </div>

          <div class="mt-8 rounded-[32px] bg-slate-950 px-6 py-8 text-slate-50 dark:bg-slate-900">
            ${
              mode === "WORKING" && activeSession
                ? `
              <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Cockpit view</p>
              <div class="mt-4 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                <div>
                  <p class="text-sm text-slate-400">Session ${activeSession.cycle}</p>
                  <div class="mt-2 text-6xl font-semibold tracking-tight md:text-8xl" data-role="working-countdown">
                    ${formatDuration(activeSession.endsAt - Date.now())}
                  </div>
                  <p class="mt-3 text-sm text-slate-400">Break hits at ${formatClockTime(activeSession.endsAt)}</p>
                </div>
                <button
                  id="end-session-button"
                  class="rounded-full border border-slate-700 px-5 py-3 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
                >
                  End session
                </button>
              </div>
            `
                : `
              <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Start fast</p>
              <h2 class="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
                ${mode === "SHUTDOWN" ? "Locked until tomorrow’s start time." : "Start a session in under ten seconds."}
              </h2>
              <p class="mt-4 max-w-2xl text-base text-slate-300">
                ${DEV_MODE ? "DEV_MODE is enabled. Work and break intervals are shortened for fast testing." : "The timer matters less than the lock. Once the break starts, every tab gets blocked."}
              </p>
              <button
                id="start-session-button"
                class="mt-8 rounded-full bg-amber-300 px-6 py-4 text-base font-medium text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                ${mode === "SHUTDOWN" ? "disabled" : ""}
              >
                Start session
              </button>
            `
            }
          </div>

          <div class="mt-8 grid gap-4 md:grid-cols-2">
            <article class="tg-panel rounded-[24px] p-5">
              <p class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Completed today</p>
              <p class="mt-4 text-4xl font-semibold">${todaySessions.length}</p>
            </article>
            <article class="tg-panel rounded-[24px] p-5">
              <p class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Total focus time</p>
              <p class="mt-4 text-4xl font-semibold">${formatMinutes(totalFocusMinutes)}</p>
            </article>
          </div>
        </section>

        <aside class="tg-panel rounded-[32px] p-6 md:p-8">
          <p class="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Today’s history</p>
          <div class="mt-6 space-y-4">
            ${
              todaySessions.length === 0
                ? `
              <div class="rounded-[24px] border border-dashed border-slate-300/80 px-5 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No completed sessions yet. Start one from the dashboard.
              </div>
            `
                : todaySessions
                    .map(
                      (session) => `
                  <article class="rounded-[24px] border border-slate-200/80 bg-white/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/30">
                    <div class="flex items-center justify-between gap-3">
                      <p class="font-medium">Session ${session.cycle}</p>
                      <p class="text-sm text-slate-500 dark:text-slate-400">${formatMinutes(session.workDurationMinutes)}</p>
                    </div>
                    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">${escapeHtml(session.goalSnapshot)}</p>
                    <p class="mt-3 text-xs uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                      Completed ${formatClockTime(session.completedAt)}
                    </p>
                  </article>
                `,
                    )
                    .join("")
            }
          </div>
        </aside>
      </div>

      ${
        isLocked
          ? `
        <div class="tg-page-lock">
          <section class="tg-page-lock-card tg-page-lock-card--${mode === "BREAK" ? "break" : "shutdown"}">
            <p class="text-xs uppercase tracking-[0.35em] text-white/80">${mode === "BREAK" ? "Mandatory break" : "Daily shutdown"}</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-tight">${mode === "BREAK" ? "bro step away from the keyboard" : "you're done for today"}</h2>
            <p class="mt-4 text-base text-white/85">
              ${mode === "BREAK" ? "Every tab is locked until the countdown ends or you type the recovery phrase in another tab." : `Unlocked at ${formatClockTime(lockEndsAt)}.`}
            </p>
            <div class="mt-6 text-5xl font-semibold" data-role="lock-countdown">${formatDuration(lockEndsAt - Date.now())}</div>
            ${
              DEV_MODE
                ? `
              <button
                id="dev-bypass-button"
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

  const goalInput = document.getElementById("goal-input") as HTMLInputElement | null;
  const startButton = document.getElementById("start-session-button");
  const endButton = document.getElementById("end-session-button");
  const devBypassButton = document.getElementById("dev-bypass-button");

  goalInput?.addEventListener("input", () => {
    goalDraft = goalInput.value;
  });

  goalInput?.addEventListener("blur", () => {
    const nextGoal = goalInput.value.trim();
    if (nextGoal && nextGoal !== appState?.settings.goal) {
      void request({ type: "UPDATE_SETTINGS", payload: { goal: nextGoal } });
    }
  });

  goalInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goalInput.blur();
    }
  });

  startButton?.addEventListener("click", async () => {
    const response = await request({ type: "START_SESSION" });
    if (response.ok) {
      playSound(SOUND_FILES.sessionStart);
    }
  });

  endButton?.addEventListener("click", () => {
    void request({ type: "END_SESSION" });
  });

  devBypassButton?.addEventListener("click", () => {
    void request({ type: "DISMISS_OVERLAY_DEV" });
  });

  startLiveTicker();
}

function applyState(nextState: StoredAppState): void {
  const previousMode = lastMode;
  appState = nextState;
  lastMode = nextState.recoveryState.mode;

  const activeElement = document.activeElement;
  if (
    !(
      activeElement instanceof HTMLInputElement &&
      activeElement.id === "goal-input"
    )
  ) {
    goalDraft = nextState.settings.goal;
  }

  render();

  if (
    previousMode !== nextState.recoveryState.mode &&
    nextState.recoveryState.mode === "SHUTDOWN"
  ) {
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

  goalDraft = response.appState.settings.goal;
  applyState(response.appState);
}

void bootstrap();
