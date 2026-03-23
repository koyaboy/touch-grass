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
  const shellModeClass =
    mode === "WORKING" ? "tg-screen--working" : mode === "SHUTDOWN" ? "tg-screen--shutdown" : "tg-screen--idle";

  appRoot.innerHTML = `
    <main class="tg-shell">
      <section class="tg-screen ${shellModeClass}">
        <div class="tg-surface flex min-h-screen flex-col p-5 md:p-8">
          <header class="flex items-center justify-between">
            <p class="tg-brand text-[11px] font-medium text-white/72">Touch Grass</p>
            <a
              href="/settings/index.html"
              class="rounded-full border border-white/18 bg-white/6 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-white/78 transition hover:bg-white/12"
              aria-label="Open settings"
            >
              Settings
            </a>
          </header>

          ${
            mode === "WORKING" && activeSession
              ? `
            <section class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between py-12 md:py-16">
              <div class="tg-muted flex items-center gap-3 text-xs uppercase tracking-[0.28em]">
                <span class="tg-status-dot"></span>
                Mission active
              </div>

              <div class="max-w-4xl">
                <p class="tg-muted text-sm uppercase tracking-[0.34em]">Session ${activeSession.cycle}</p>
                <h1 class="tg-mission-heading mt-4 text-5xl leading-[0.88] text-white md:text-8xl">Lock in.</h1>
                <p class="mt-5 max-w-2xl text-base text-white/62 md:text-lg">${escapeHtml(activeSession.goalSnapshot)}</p>
              </div>

              <div class="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
                <div class="tg-mission-panel rounded-[36px] p-6 md:p-8">
                  <p class="text-xs uppercase tracking-[0.3em] text-white/44">Focus clock</p>
                  <div class="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white md:text-[10rem]" data-role="working-countdown">
                    ${formatDuration(activeSession.endsAt - Date.now())}
                  </div>
                  <div class="mt-4 flex flex-wrap items-center gap-4 text-sm text-white/56">
                    <span>Break begins at ${formatClockTime(activeSession.endsAt)}</span>
                    <span class="inline-block h-1 w-1 rounded-full bg-white/36"></span>
                    <span>${todaySessions.length} sessions completed today</span>
                  </div>
                </div>

                <div class="space-y-4">
                  <article class="tg-glass rounded-[28px] p-5">
                    <p class="text-xs uppercase tracking-[0.28em] text-white/44">Focus time today</p>
                    <p class="mt-3 text-4xl font-semibold text-white">${formatMinutes(totalFocusMinutes)}</p>
                  </article>
                  <button
                    id="end-session-button"
                    class="w-full rounded-full border border-white/18 bg-white/8 px-5 py-4 text-sm font-medium uppercase tracking-[0.24em] text-white transition hover:bg-white/14"
                  >
                    End session
                  </button>
                </div>
              </div>
            </section>
          `
              : mode === "SHUTDOWN"
                ? `
            <section class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-12 text-center">
              <div class="w-full max-w-3xl">
                <p class="tg-muted text-sm uppercase tracking-[0.32em]">Shutdown</p>
                <h1 class="tg-heading mt-5 text-5xl leading-[0.92] text-white md:text-8xl">You tried today.</h1>
                <p class="mx-auto mt-5 max-w-xl text-base leading-7 text-white/72 md:text-lg">No more work tonight.</p>
              </div>

              <div class="tg-glass mt-10 w-full max-w-2xl rounded-[42px] p-7 md:p-10">
                <p class="text-[11px] uppercase tracking-[0.34em] text-white/48">Unlocks at</p>
                <div class="mt-4 text-5xl font-semibold tracking-[-0.05em] text-white md:text-7xl">${formatClockTime(lockEndsAt)}</div>
                <p class="mt-6 text-sm uppercase tracking-[0.24em] text-white/44">Current goal</p>
                <p class="mt-3 text-2xl text-white/80 md:text-3xl">${escapeHtml(goalDraft || "lock in")}</p>
              </div>
            </section>
          `
              : `
            <section class="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center py-12 text-center">
              <div class="w-full max-w-3xl">
                <p class="tg-muted text-sm uppercase tracking-[0.32em]">Recovery enforcement</p>
                <h1 class="tg-heading mt-5 text-5xl leading-[0.94] text-white md:text-8xl">Touch grass.</h1>
                <p class="mx-auto mt-5 max-w-xl text-base leading-7 text-white/68 md:text-lg">Then come back sharper.</p>
              </div>

              <div class="tg-glass mt-10 w-full max-w-xl rounded-[40px] p-6 md:p-8">
                <p class="text-[11px] uppercase tracking-[0.34em] text-white/54">Current goal</p>
                <input
                  id="goal-input"
                  class="tg-goal-input tg-heading mt-5 pb-3 text-center text-3xl text-white placeholder:text-white/38 md:text-5xl"
                  value="${escapeHtml(goalDraft)}"
                  placeholder="lock in"
                />
                <button
                  id="start-session-button"
                  class="mt-8 rounded-full bg-white px-10 py-4 text-sm font-semibold uppercase tracking-[0.28em] text-slate-950 transition hover:bg-white/88 disabled:cursor-not-allowed disabled:bg-white/18 disabled:text-white/45"
                >
                  Start session
                </button>
                <p class="mt-4 text-xs uppercase tracking-[0.26em] text-white/48">
                  ${DEV_MODE ? "DEV MODE active" : "One tap to begin"}
                </p>
              </div>

              <div class="mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-[0.8fr_1.2fr]">
                <article class="tg-glass rounded-[28px] p-5 text-left">
                  <p class="text-[11px] uppercase tracking-[0.3em] text-white/52">Today</p>
                  <div class="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <p class="text-4xl font-semibold text-white">${todaySessions.length}</p>
                      <p class="mt-1 text-sm text-white/58">sessions completed</p>
                    </div>
                    <p class="text-sm text-white/58">${formatMinutes(totalFocusMinutes)} focused</p>
                  </div>
                </article>

                <aside class="tg-glass rounded-[28px] p-5 text-left">
                  <p class="text-[11px] uppercase tracking-[0.3em] text-white/52">History</p>
                  <div class="mt-4 space-y-3">
                    ${
                      todaySessions.length === 0
                        ? `
                      <p class="text-sm text-white/54">No sessions yet.</p>
                    `
                        : todaySessions
                            .slice(0, 3)
                            .map(
                              (session) => `
                          <article class="tg-history-card rounded-[22px] px-4 py-3">
                            <div class="flex items-center justify-between gap-3">
                              <p class="text-sm font-medium text-white">Session ${session.cycle}</p>
                              <p class="text-xs uppercase tracking-[0.24em] text-white/44">${formatMinutes(session.workDurationMinutes)}</p>
                            </div>
                            <p class="mt-2 text-sm text-white/58">${escapeHtml(session.goalSnapshot)}</p>
                          </article>
                        `,
                            )
                            .join("")
                    }
                  </div>
                </aside>
              </div>
            </section>
          `
          }
        </div>
      </section>

      ${
        isLocked
          ? `
        <div class="tg-page-lock">
          <section class="tg-page-lock-card tg-page-lock-card--${mode === "BREAK" ? "break" : "shutdown"}">
            <p class="text-xs uppercase tracking-[0.35em] text-white/74">${mode === "BREAK" ? "Mandatory break" : "Daily shutdown"}</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">${mode === "BREAK" ? "bro step away from the keyboard" : "you're done for today"}</h2>
            <p class="mt-5 max-w-2xl text-base leading-7 text-white/82">
              ${mode === "BREAK" ? "Every normal tab will re-lock. Stretch, walk, get water, blink like a person, then come back." : `Unlocked at ${formatClockTime(lockEndsAt)}. The workday is over. You can pick it back up tomorrow.`}
            </p>
            ${
              mode === "BREAK"
                ? `
              <div class="tg-lock-meme mt-6">
                <span>🧍</span>
                <span>no more heroic debugging right now</span>
              </div>
            `
                : `
              <div class="tg-lock-meme mt-6">
                <span>🌙</span>
                <span>rest is part of the system</span>
              </div>
            `
            }
            <div class="mt-8 text-5xl font-semibold tracking-[-0.05em] md:text-7xl" data-role="lock-countdown">${formatDuration(lockEndsAt - Date.now())}</div>
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
