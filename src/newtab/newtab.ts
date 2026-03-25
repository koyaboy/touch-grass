import { DEV_MODE, SOUND_FILES, SOUND_VOLUME, STORAGE_KEY } from "../config";
import type { CheckInAction, RuntimeResponseMessage, StoredAppState } from "../types";
import { getTodaySessionHistory, normalizeAppState } from "../utils/storage";
import { formatClockTime, formatDuration, formatMinutes, getNextOccurrence } from "../utils/time";

const app = document.getElementById("app");

if (!app) {
  throw new Error("New tab root element was not found.");
}

const appRoot = app;

const STATE_BACKGROUNDS = {
  IDLE: [
    "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1473773508845-188df298d2d1?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?auto=format&fit=crop&w=1800&q=80",
  ],
  WORKING: [
    "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1517832207067-4db24a2ae47c?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1800&q=80",
  ],
  SHUTDOWN: [
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1800&q=80",
  ],
} as const;

let appState: StoredAppState | null = null;
let liveTimerId: number | null = null;
let goalDraft = "";
let lastMode = "IDLE";
let lastSessionStartSound = "";
let guideOpen = false;
let onboardingError = "";

function log(...args: unknown[]): void {
  if (DEV_MODE) {
    console.log("[touch-grass:newtab]", ...args);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isOnboardingComplete(state: StoredAppState): boolean {
  return state.settings.onboardingCompleted;
}

function pickRandomSessionStartSound(): string {
  const soundOptions: readonly string[] = SOUND_FILES.sessionStart;

  if (soundOptions.length === 0) {
    return "";
  }

  if (soundOptions.length === 1) {
    lastSessionStartSound = soundOptions[0];
    return soundOptions[0];
  }

  const filtered = soundOptions.filter((option) => option !== lastSessionStartSound);
  const candidatePool = filtered.length > 0 ? filtered : [...soundOptions];
  const nextSound = candidatePool[Math.floor(Math.random() * candidatePool.length)];
  lastSessionStartSound = nextSound;
  return nextSound;
}

function playSessionStartSound(): void {
  if (!appState?.settings.soundEnabled) {
    return;
  }

  const soundPath = pickRandomSessionStartSound();

  if (!soundPath) {
    return;
  }

  const audio = new Audio(chrome.runtime.getURL(soundPath));
  audio.volume = SOUND_VOLUME;

  void audio.play().catch((error) => {
    log("session sound failed", soundPath, error);
  });
}

function getClockBucket(): number {
  const hour = new Date().getHours();

  if (hour < 6) {
    return 0;
  }

  if (hour < 12) {
    return 1;
  }

  if (hour < 18) {
    return 2;
  }

  return 3;
}

function getBackgroundForMode(mode: "IDLE" | "WORKING" | "SHUTDOWN"): string {
  const images = STATE_BACKGROUNDS[mode];
  return images[getClockBucket() % images.length];
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

function getShutdownWarning(state: StoredAppState): string | null {
  if (state.recoveryState.mode === "SHUTDOWN" || !state.settings.hardShutdownTime) {
    return null;
  }

  const nextShutdown = getNextOccurrence(state.settings.hardShutdownTime, Date.now() - 60_000);
  const remainingMs = nextShutdown - Date.now();

  if (remainingMs <= 0 || remainingMs > 90 * 60_000) {
    return null;
  }

  return `Shutdown in ${formatDuration(remainingMs)} at ${formatClockTime(nextShutdown)}`;
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

  const pausedCountdown = document.querySelector("[data-role='paused-countdown']");
  if (pausedCountdown instanceof HTMLElement && appState.recoveryState.pausedWork) {
    pausedCountdown.textContent = formatDuration(appState.recoveryState.pausedWork.remainingMs);
  }

  const lockCountdown = document.querySelector("[data-role='lock-countdown']");
  if (lockCountdown instanceof HTMLElement) {
    const endsAt =
      appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt;
    if (endsAt) {
      lockCountdown.textContent = formatDuration(endsAt - Date.now());
    }
  }

  const shutdownWarning = document.querySelector("[data-role='shutdown-warning']");
  if (shutdownWarning instanceof HTMLElement) {
    shutdownWarning.textContent = getShutdownWarning(appState) ?? "";
  }
}

function startLiveTicker(): void {
  if (liveTimerId) {
    window.clearInterval(liveTimerId);
  }

  liveTimerId = window.setInterval(renderLiveValues, 1000);
  renderLiveValues();
}

function renderGuideModal(state: StoredAppState): string {
  const shutdownEnabled = Boolean(state.settings.hardShutdownTime);

  return `
    <div class="tg-guide-modal">
      <section class="tg-guide-panel">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="tg-muted text-xs uppercase tracking-[0.34em]">How it works</p>
            <h2 class="tg-heading mt-3 text-4xl text-white md:text-5xl">The lock is the feature.</h2>
          </div>
          <button
            type="button"
            data-guide="close"
            class="tg-shell-link tg-shell-link--ghost"
            aria-label="Close guide"
          >
            Close
          </button>
        </div>

        <div class="tg-guide-grid mt-8">
          <article class="tg-guide-step">
            <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">1</p>
            <h3 class="mt-3 text-2xl text-white">Work with intent</h3>
            <p class="mt-3 text-sm leading-6 text-white/68">
              Start a session and work until the timer ends. Your current goal is what the session is measured against.
            </p>
          </article>
          <article class="tg-guide-step">
            <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">2</p>
            <h3 class="mt-3 text-2xl text-white">Break means break</h3>
            <p class="mt-3 text-sm leading-6 text-white/68">
              When work ends, the extension locks you into a real break. You do not keep browsing through it.
            </p>
          </article>
          <article class="tg-guide-step">
            <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">3</p>
            <h3 class="mt-3 text-2xl text-white">Decide what happens next</h3>
            <p class="mt-3 text-sm leading-6 text-white/68">
              After the break, you either continue the same goal, switch goals, or stop.
            </p>
          </article>
        </div>

        <div class="tg-guide-grid mt-5">
          <article class="tg-guide-step">
            <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">Shutdown time</p>
            <p class="mt-3 text-sm leading-6 text-white/68">
              This is an optional daily cutoff. After that time, new sessions are blocked until your next start time.
            </p>
          </article>
          <article class="tg-guide-step">
            <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">Current status</p>
            <p class="mt-3 text-sm leading-6 text-white/68">
              ${shutdownEnabled
                ? `Shutdown is currently active in your setup at ${escapeHtml(
                    state.settings.hardShutdownTime,
                  )}.`
                : "Shutdown is currently off. You can leave it off until you actually want a nightly cutoff."}
            </p>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderOnboarding(state: StoredAppState): string {
  const settings = state.settings;

  return `
    <section class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center py-10 md:py-14">
      <div class="max-w-3xl">
        <p class="tg-muted text-sm uppercase tracking-[0.34em]">First run</p>
        <h1 class="tg-heading mt-4 text-5xl leading-[0.92] text-white md:text-8xl">Set the rhythm before you start.</h1>
        <p class="mt-5 max-w-2xl text-base leading-7 text-white/72 md:text-lg">
          Touch Grass enforces work, breaks, and optional shutdown. Start by configuring the core session loop. You can add stricter boundaries later.
        </p>
      </div>

      <div class="tg-setup-grid mt-8">
        <form id="onboarding-form" class="tg-glass rounded-[34px] p-6 md:p-8">
          <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">Essentials</p>
          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="tg-setup-field">
              <span>Work duration (minutes)</span>
              <input name="workDurationMinutes" type="number" min="1" value="${settings.workDurationMinutes}" />
              <small>How long you focus before the extension forces a break.</small>
            </label>
            <label class="tg-setup-field">
              <span>Break duration (minutes)</span>
              <input name="breakDurationMinutes" type="number" min="1" value="${settings.breakDurationMinutes}" />
              <small>How long the break lock lasts before check-in.</small>
            </label>
          </div>

          <label class="tg-setup-field mt-4">
            <span>Starting goal</span>
            <input
              name="goal"
              type="text"
              value="${escapeHtml(goalDraft)}"
              placeholder="Optional for now"
            />
            <small>This shows up on the dashboard and during check-in. You can change it anytime.</small>
          </label>

          <label class="tg-setup-toggle mt-4">
            <input name="soundEnabled" type="checkbox" ${settings.soundEnabled ? "checked" : ""} />
            <span>Enable sounds for session starts, breaks, and break ambience</span>
          </label>

          <div class="mt-6 rounded-[24px] border border-white/10 bg-black/18 p-4 text-sm leading-6 text-white/68">
            Shutdown time is optional and starts off disabled. You can add a nightly cutoff later in Settings once the basic loop feels right.
          </div>

          <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-sm text-amber-100/82">${escapeHtml(onboardingError || "Save these essentials to unlock your first session.")}</p>
            <button type="submit" class="tg-action-button sm:w-auto sm:min-w-[240px]">Finish setup</button>
          </div>
        </form>

        <aside class="tg-glass rounded-[34px] p-6 md:p-8">
          <p class="text-[11px] uppercase tracking-[0.3em] text-white/46">What to expect</p>
          <div class="mt-5 space-y-4">
            <article class="tg-guide-step">
              <h3 class="text-2xl text-white">Start focused</h3>
              <p class="mt-2 text-sm leading-6 text-white/68">One goal, one timer, one clear end point.</p>
            </article>
            <article class="tg-guide-step">
              <h3 class="text-2xl text-white">Take the break</h3>
              <p class="mt-2 text-sm leading-6 text-white/68">When time is up, the extension locks you out long enough to actually step away.</p>
            </article>
            <article class="tg-guide-step">
              <h3 class="text-2xl text-white">Check back in</h3>
              <p class="mt-2 text-sm leading-6 text-white/68">After the break, decide whether to continue, switch goals, or stop.</p>
            </article>
          </div>

          <button
            type="button"
            data-guide="open"
            class="tg-shell-link mt-6 w-full justify-center"
          >
            Read the full guide
          </button>
        </aside>
      </div>
    </section>
  `;
}

function renderCheckIn(state: StoredAppState): string {
  const checkIn = state.recoveryState.checkIn;
  if (!checkIn) {
    return "";
  }

  return `
    <section class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-12 text-center">
      <div class="w-full max-w-3xl">
        <p class="tg-muted text-sm uppercase tracking-[0.32em]">Break complete</p>
        <h1 class="tg-heading mt-5 text-5xl leading-[0.94] text-white md:text-7xl">Still on this goal?</h1>
      </div>

      <div class="tg-glass mt-10 w-full max-w-2xl rounded-[42px] p-7 md:p-10">
        <p class="text-[11px] uppercase tracking-[0.34em] text-white/48">Current goal</p>
        <p class="mt-4 text-3xl text-white md:text-5xl">${escapeHtml(checkIn.goalSnapshot)}</p>
        <div class="mt-8 grid gap-3 md:grid-cols-3">
          <button type="button" data-checkin="resume_same_goal" class="tg-action-button">Keep going</button>
          <button type="button" data-checkin="resume_new_goal" class="tg-action-button tg-action-button--muted">Something else</button>
          <button type="button" data-checkin="stop" class="tg-action-button tg-action-button--ghost">Done</button>
        </div>
      </div>

      <div class="tg-glass mt-6 w-full max-w-xl rounded-[30px] p-5 text-left">
        <p class="text-[11px] uppercase tracking-[0.3em] text-white/48">New goal if needed</p>
        <input
          id="goal-input"
          class="tg-goal-input tg-heading mt-4 pb-3 text-2xl text-white placeholder:text-white/34 md:text-4xl"
          value="${escapeHtml(goalDraft)}"
          placeholder="lock in"
        />
      </div>
    </section>
  `;
}

function renderIdle(
  state: StoredAppState,
  todaySessions: ReturnType<typeof getTodaySessionHistory>,
  totalFocusMinutes: number,
): string {
  const shutdownWarning = getShutdownWarning(state);

  return `
    <section class="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center py-12 text-center">
      <div class="w-full max-w-3xl">
        <p class="tg-muted text-sm uppercase tracking-[0.32em]">Recovery enforcement</p>
        <h1 class="tg-heading mt-5 text-5xl leading-[0.94] text-white md:text-8xl">Touch grass.</h1>
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
          type="button"
          id="start-session-button"
          class="tg-action-button mt-8"
        >
          Start session
        </button>
        <p class="mt-4 text-xs uppercase tracking-[0.26em] text-white/48">${DEV_MODE ? "DEV MODE active" : "One tap to begin"}</p>
        <button
          type="button"
          data-guide="open"
          class="tg-shell-link mt-4 w-full justify-center"
        >
          How it works
        </button>
      </div>

      <div class="mt-6 min-h-[20px] text-xs uppercase tracking-[0.24em] text-amber-200/90" data-role="shutdown-warning">
        ${shutdownWarning ?? ""}
      </div>

      <div class="mt-6 grid w-full max-w-4xl gap-4 md:grid-cols-[0.8fr_1.2fr]">
        <article class="tg-glass rounded-[28px] p-5 text-left">
          <p class="text-[11px] uppercase tracking-[0.3em] text-white/52">Today</p>
          <div class="mt-4 flex items-end justify-between gap-4">
            <div>
              <p class="text-4xl font-semibold text-white">${todaySessions.length}</p>
              <p class="mt-1 text-sm text-white/58">sessions</p>
            </div>
            <p class="text-sm text-white/58">${formatMinutes(totalFocusMinutes)} focused</p>
          </div>
        </article>

        <aside class="tg-glass rounded-[28px] p-5 text-left">
          <p class="text-[11px] uppercase tracking-[0.3em] text-white/52">History</p>
          <div class="mt-4 space-y-3">
            ${
              todaySessions.length === 0
                ? `<p class="text-sm text-white/54">No sessions yet.</p>`
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
  `;
}

function renderWorking(state: StoredAppState, totalFocusMinutes: number): string {
  const activeSession = state.recoveryState.activeSession;
  if (!activeSession) {
    return "";
  }

  return `
    <section class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between py-12 md:py-16">
      <div class="tg-muted flex items-center gap-3 text-xs uppercase tracking-[0.28em]">
        <span class="tg-status-dot"></span>
        Mission active
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
        <div class="max-w-4xl">
          <p class="tg-muted text-sm uppercase tracking-[0.34em]">Session ${activeSession.cycle}</p>
          <h1 class="tg-mission-heading mt-4 text-5xl leading-[0.88] text-white md:text-8xl">Lock in.</h1>
          <div class="tg-goal-card mt-8 rounded-[34px] p-6 md:p-8">
            <p class="text-[11px] uppercase tracking-[0.32em] text-white/42">Current goal</p>
            <p class="mt-4 text-3xl leading-tight text-white md:text-5xl">${escapeHtml(activeSession.goalSnapshot)}</p>
          </div>
        </div>

        <div class="space-y-4">
          <div class="tg-mission-panel rounded-[36px] p-6 md:p-8">
            <p class="text-xs uppercase tracking-[0.3em] text-white/44">Focus clock</p>
            <div class="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white md:text-[9rem]" data-role="working-countdown">
              ${formatDuration(activeSession.endsAt - Date.now())}
            </div>
            <div class="mt-4 text-sm text-white/56">
              Break at ${formatClockTime(activeSession.endsAt)}
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <button type="button" id="pause-session-button" class="tg-action-button tg-action-button--muted">Pause</button>
            <button type="button" id="end-session-button" class="tg-action-button tg-action-button--ghost">End</button>
          </div>

          <article class="tg-glass rounded-[28px] p-5">
            <p class="text-xs uppercase tracking-[0.28em] text-white/44">Today</p>
            <p class="mt-3 text-4xl font-semibold text-white">${formatMinutes(totalFocusMinutes)}</p>
            <p class="mt-3 text-xs uppercase tracking-[0.24em] text-amber-200/90" data-role="shutdown-warning">${getShutdownWarning(state) ?? ""}</p>
          </article>
        </div>
      </div>
    </section>
  `;
}

function renderPaused(state: StoredAppState): string {
  const pausedWork = state.recoveryState.pausedWork;
  if (!pausedWork) {
    return "";
  }

  return `
    <section class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-12 text-center">
      <div class="w-full max-w-3xl">
        <p class="tg-muted text-sm uppercase tracking-[0.32em]">Paused</p>
        <h1 class="tg-heading mt-5 text-5xl leading-[0.94] text-white md:text-7xl">Timer is paused.</h1>
      </div>

      <div class="tg-glass mt-10 w-full max-w-2xl rounded-[42px] p-7 md:p-10">
        <p class="text-[11px] uppercase tracking-[0.34em] text-white/48">Current goal</p>
        <p class="mt-4 text-3xl text-white md:text-5xl">${escapeHtml(pausedWork.goalSnapshot)}</p>
        <div class="mt-8 text-5xl font-semibold tracking-[-0.05em] text-white md:text-7xl" data-role="paused-countdown">${formatDuration(pausedWork.remainingMs)}</div>
        <div class="mt-8 grid gap-3 md:grid-cols-2">
          <button type="button" id="resume-session-button" class="tg-action-button">Resume</button>
          <button type="button" id="end-session-button" class="tg-action-button tg-action-button--ghost">End</button>
        </div>
      </div>
    </section>
  `;
}

function renderShutdown(state: StoredAppState): string {
  const unlockAt = state.recoveryState.shutdown?.unlockAt ?? Date.now();

  return `
    <section class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-12 text-center">
      <div class="w-full max-w-3xl">
        <p class="tg-muted text-sm uppercase tracking-[0.32em]">Shutdown</p>
        <h1 class="tg-heading mt-5 text-5xl leading-[0.92] text-white md:text-8xl">You tried today.</h1>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/72 md:text-lg">No more work tonight. This screen exists to end the loop, not extend it.</p>
      </div>

      <div class="tg-glass mt-10 w-full max-w-2xl rounded-[42px] p-7 md:p-10">
        <p class="text-[11px] uppercase tracking-[0.34em] text-white/48">Unlocks at</p>
        <div class="mt-4 text-5xl font-semibold tracking-[-0.05em] text-white md:text-7xl">${formatClockTime(unlockAt)}</div>
        <p class="mt-6 text-sm uppercase tracking-[0.24em] text-white/44">Purpose</p>
        <p class="mt-3 text-lg text-white/80 md:text-2xl">Rest, reset, and come back tomorrow with intent.</p>
      </div>
    </section>
  `;
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
  const onboardingComplete = isOnboardingComplete(appState);
  const lockEndsAt =
    appState.recoveryState.activeBreak?.endsAt ?? appState.recoveryState.shutdown?.unlockAt ?? 0;
  const isLocked = mode === "BREAK" || mode === "SHUTDOWN";
  const backgroundMode =
    mode === "WORKING" || mode === "PAUSED" || mode === "CHECK_IN"
      ? "WORKING"
      : mode === "SHUTDOWN"
        ? "SHUTDOWN"
        : "IDLE";

  const screenContent =
    !onboardingComplete && mode === "IDLE"
      ? renderOnboarding(appState)
      : mode === "WORKING"
        ? renderWorking(appState, totalFocusMinutes)
        : mode === "PAUSED"
          ? renderPaused(appState)
          : mode === "CHECK_IN"
            ? renderCheckIn(appState)
            : mode === "SHUTDOWN"
              ? renderShutdown(appState)
              : renderIdle(appState, todaySessions, totalFocusMinutes);

  appRoot.innerHTML = `
    <main class="tg-shell">
      <section class="tg-screen tg-screen--${backgroundMode.toLowerCase()}" style="--tg-bg-image: url('${getBackgroundForMode(backgroundMode)}')">
        <div class="tg-surface flex min-h-screen flex-col p-5 md:p-8">
          <header class="flex items-center justify-between">
            <p class="tg-brand text-[11px] font-medium text-white/72">Touch Grass</p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                data-guide="open"
                class="tg-shell-link tg-shell-link--ghost"
              >
                Guide
              </button>
              <a
                href="/settings/index.html"
                class="tg-shell-link"
                aria-label="Open settings"
              >
                ${onboardingComplete ? "Settings" : "Setup"}
              </a>
            </div>
          </header>
          ${screenContent}
        </div>
      </section>
      ${guideOpen ? renderGuideModal(appState) : ""}

      ${
        isLocked
          ? `
        <div class="tg-page-lock">
          <section class="tg-page-lock-card tg-page-lock-card--${mode === "BREAK" ? "break" : "shutdown"}">
            <p class="text-xs uppercase tracking-[0.35em] text-white/74">${mode === "BREAK" ? "Mandatory break" : "Daily shutdown"}</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">${mode === "BREAK" ? "bro step away from the keyboard" : "you're done for today"}</h2>
            <p class="mt-5 max-w-2xl text-base leading-7 text-white/82">
              ${mode === "BREAK" ? "Mandatory break. Stand up, drink water, and let your eyes reset before you come back." : `Shutdown lock until ${formatClockTime(lockEndsAt)}. This exists to stop the extra hour from becoming three.`}
            </p>
            <div class="tg-lock-gallery mt-6">
              ${
                mode === "BREAK"
                  ? `
                <div class="tg-lock-image" style="background-image:url('https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80')"></div>
                <div class="tg-lock-image" style="background-image:url('https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80')"></div>
              `
                  : `
                <div class="tg-lock-image" style="background-image:url('https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80')"></div>
                <div class="tg-lock-image" style="background-image:url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80')"></div>
              `
              }
            </div>
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
  const onboardingForm = document.getElementById("onboarding-form") as HTMLFormElement | null;
  const startButton = document.getElementById("start-session-button");
  const endButton = document.getElementById("end-session-button");
  const pauseButton = document.getElementById("pause-session-button");
  const resumeButton = document.getElementById("resume-session-button");
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

  onboardingForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    onboardingError = "";

    const formData = new FormData(onboardingForm);
    const response = await request({
      type: "UPDATE_SETTINGS",
      payload: {
        goal: String(formData.get("goal") ?? ""),
        workDurationMinutes: Number(formData.get("workDurationMinutes") ?? 45),
        breakDurationMinutes: Number(formData.get("breakDurationMinutes") ?? 15),
        soundEnabled: formData.get("soundEnabled") === "on",
        onboardingCompleted: true,
      },
    });

    if (!response.ok || !response.appState) {
      onboardingError = response.ok ? "Could not save onboarding." : response.error;
      render();
      return;
    }

    goalDraft = response.appState.settings.goal;
    applyState(response.appState);
  });

  document.querySelectorAll("[data-guide]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = (button as HTMLElement).getAttribute("data-guide");
      guideOpen = action === "open";
      render();
    });
  });

  document.querySelectorAll("[data-checkin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = (button as HTMLElement).getAttribute("data-checkin") as CheckInAction | null;
      if (action) {
        try {
          const response = await request({ type: "CHECK_IN_DECISION", action });
          if (response.ok && response.appState) {
            log("check-in action", action, response.appState.recoveryState.mode);
            applyState(response.appState);
            if (response.appState.recoveryState.mode === "WORKING") {
              playSessionStartSound();
            }
          }
        } catch (error) {
          log("check-in failed", action, error);
        }
      }
    });
  });

  startButton?.addEventListener("click", async () => {
    try {
      const response = await request({ type: "START_SESSION" });
      if (response.ok && response.appState) {
        log("start session", response.appState.recoveryState.mode);
        applyState(response.appState);
        if (response.appState.recoveryState.mode === "WORKING") {
          playSessionStartSound();
        }
      }
    } catch (error) {
      log("start session failed", error);
    }
  });

  pauseButton?.addEventListener("click", async () => {
    try {
      const response = await request({ type: "PAUSE_SESSION" });
      if (response.ok && response.appState) {
        log("pause session", response.appState.recoveryState.mode);
        applyState(response.appState);
      }
    } catch (error) {
      log("pause session failed", error);
    }
  });

  resumeButton?.addEventListener("click", async () => {
    try {
      const response = await request({ type: "RESUME_SESSION" });
      if (response.ok && response.appState) {
        log("resume session", response.appState.recoveryState.mode);
        applyState(response.appState);
      }
    } catch (error) {
      log("resume session failed", error);
    }
  });

  endButton?.addEventListener("click", async () => {
    try {
      const response = await request({ type: "END_SESSION" });
      if (response.ok && response.appState) {
        log("end session", response.appState.recoveryState.mode);
        applyState(response.appState);
      }
    } catch (error) {
      log("end session failed", error);
    }
  });

  devBypassButton?.addEventListener("click", async () => {
    const response = await request({ type: "DISMISS_OVERLAY_DEV" });
    if (response.ok && response.appState) {
      applyState(response.appState);
    }
  });

  startLiveTicker();
}

function applyState(nextState: StoredAppState): void {
  const previousMode = lastMode;
  appState = nextState;
  lastMode = nextState.recoveryState.mode;
  onboardingError = "";

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLInputElement && activeElement.id === "goal-input")) {
    goalDraft = nextState.settings.goal;
  }

  render();

  if (previousMode !== nextState.recoveryState.mode) {
    log("mode change", previousMode, "->", nextState.recoveryState.mode);
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
