import {
  ALARM_NAMES,
  BREAK_AMBIENT_VOLUME,
  DEV_MODE,
  OVERLAY_ASSETS,
  SOUND_FILES,
  getEffectiveBreakDurationMs,
  getEffectiveWorkDurationMs,
} from "../config";
import type {
  ActiveSession,
  CheckInAction,
  OffscreenRuntimeMessage,
  OverlayPayload,
  OverlaySyncMessage,
  RuntimeRequestMessage,
  RuntimeResponseMessage,
  SessionHistoryItem,
  StoredAppState,
  UserSettings,
} from "../types";
import {
  getStoredAppState,
  getTodaySessionHistory,
  sanitizeSettings,
  setStoredAppState,
} from "../utils/storage";
import { formatClockTime, getActiveTimeWindow, getNextOccurrence } from "../utils/time";

const NON_SCRIPTABLE_PROTOCOLS = ["chrome://", "chrome-extension://", "edge://", "about:"];
const NEW_TAB_PROTOCOLS = ["chrome://newtab/", "edge://newtab/"];
const OFFSCREEN_DOCUMENT_PATH = "offscreen/index.html";
const BREAK_AMBIENT_CHANNEL = "break-ambient";

let offscreenDocumentPromise: Promise<void> | null = null;
const lastPlayedSoundByChannel = new Map<string, string>();

function log(...args: unknown[]): void {
  if (DEV_MODE) {
    console.log("[touch-grass]", ...args);
  }
}

async function hasOffscreenDocument(path: string): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(path);

  if ("getContexts" in chrome.runtime) {
    const getContexts = chrome.runtime.getContexts as unknown as (filter: {
      contextTypes: string[];
      documentUrls: string[];
    }) => Promise<chrome.runtime.ExtensionContext[]>;
    const contexts = await getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });

    return contexts.length > 0;
  }

  return false;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument(OFFSCREEN_DOCUMENT_PATH)) {
    return;
  }

  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play local extension sounds for session, break, and shutdown transitions.",
    });
  }

  try {
    await offscreenDocumentPromise;
  } finally {
    offscreenDocumentPromise = null;
  }
}

async function playManagedSound(path: string, maxDurationMs?: number): Promise<void> {
  if (!path) {
    return;
  }

  try {
    await ensureOffscreenDocument();
    const message: OffscreenRuntimeMessage = {
      target: "offscreen",
      type: "PLAY_SOUND",
      path,
      maxDurationMs,
    };
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    log("managed sound skipped", path, error);
  }
}

async function startManagedLoop(
  channel: string,
  path: string,
  volume = BREAK_AMBIENT_VOLUME,
): Promise<void> {
  if (!path) {
    return;
  }

  try {
    await ensureOffscreenDocument();
    const message: OffscreenRuntimeMessage = {
      target: "offscreen",
      type: "START_LOOP",
      channel,
      path,
      volume,
    };
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    log("managed loop skipped", channel, path, error);
  }
}

async function playManagedSoundThenStartLoop(
  path: string,
  channel: string,
  loopPath: string,
  loopVolume = BREAK_AMBIENT_VOLUME,
): Promise<void> {
  if (!path || !loopPath) {
    return;
  }

  try {
    await ensureOffscreenDocument();
    const message: OffscreenRuntimeMessage = {
      target: "offscreen",
      type: "PLAY_SOUND_THEN_START_LOOP",
      path,
      channel,
      loopPath,
      loopVolume,
    };
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    log("managed sound then loop skipped", path, loopPath, error);
  }
}

async function stopManagedChannel(channel: string): Promise<void> {
  try {
    await ensureOffscreenDocument();
    const message: OffscreenRuntimeMessage = {
      target: "offscreen",
      type: "STOP_CHANNEL",
      channel,
    };
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    log("managed channel stop skipped", channel, error);
  }
}

function pickRandomSound(channel: string, soundOptions: readonly string[]): string {
  if (soundOptions.length === 0) {
    return "";
  }

  if (soundOptions.length === 1) {
    const onlyOption = soundOptions[0];
    lastPlayedSoundByChannel.set(channel, onlyOption);
    return onlyOption;
  }

  const previous = lastPlayedSoundByChannel.get(channel);
  const filtered = soundOptions.filter((option) => option !== previous);
  const candidatePool = filtered.length > 0 ? filtered : [...soundOptions];
  const nextSound = candidatePool[Math.floor(Math.random() * candidatePool.length)];
  lastPlayedSoundByChannel.set(channel, nextSound);
  return nextSound;
}

async function syncBreakAmbient(appState: StoredAppState): Promise<void> {
  if (
    appState.settings.soundEnabled &&
    appState.recoveryState.mode === "BREAK" &&
    appState.recoveryState.activeBreak
  ) {
    await startManagedLoop(
      BREAK_AMBIENT_CHANNEL,
      pickRandomSound("break-ambient", SOUND_FILES.breakAmbient),
    );
    return;
  }

  await stopManagedChannel(BREAK_AMBIENT_CHANNEL);
}

function isTabScriptable(tab: chrome.tabs.Tab): boolean {
  if (!tab.id || !tab.url) {
    return false;
  }

  return !NON_SCRIPTABLE_PROTOCOLS.some((protocol) => tab.url?.startsWith(protocol));
}

function isLockedMode(appState: StoredAppState): boolean {
  return (
    appState.recoveryState.mode === "BREAK" ||
    appState.recoveryState.mode === "CHECK_IN" ||
    appState.recoveryState.mode === "SHUTDOWN"
  );
}

function getNextCycleNumber(appState: StoredAppState): number {
  return getTodaySessionHistory(appState.sessionHistory).length + 1;
}

function getLockedPageUrl(): string {
  return chrome.runtime.getURL("newtab/index.html");
}

function isExtensionPage(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL(""));
}

function createWorkingSession(
  appState: StoredAppState,
  cycle: number,
  goalSnapshot: string,
  sessionId: ActiveSession["id"] = crypto.randomUUID(),
  remainingMs = getEffectiveWorkDurationMs(appState.settings),
): ActiveSession {
  const now = Date.now();

  return {
    id: sessionId,
    cycle,
    startedAt: now,
    endsAt: now + remainingMs,
    goalSnapshot,
  };
}

function createCompletedSession(
  appState: StoredAppState,
  completedAt: number,
): SessionHistoryItem | null {
  const activeSession = appState.recoveryState.activeSession;

  if (!activeSession) {
    return null;
  }

  return {
    id: activeSession.id,
    cycle: activeSession.cycle,
    startedAt: activeSession.startedAt,
    completedAt,
    workDurationMinutes: Math.max(
      1,
      Math.round((completedAt - activeSession.startedAt) / 60_000),
    ),
    breakDurationMinutes: Math.max(
      1,
      Math.round(getEffectiveBreakDurationMs(appState.settings) / 60_000),
    ),
    goalSnapshot: activeSession.goalSnapshot,
  };
}

function getOverlayPayload(appState: StoredAppState): OverlayPayload | null {
  const { recoveryState, settings } = appState;

  if (recoveryState.mode === "BREAK" && recoveryState.activeBreak) {
    const memeMessages = [
      "Hydrate. Stretch. Your code can wait.",
      "Step away before your spine sends legal notice.",
      "Walk around. Blink. Be a person for a minute.",
      "Recovery first. Heroic debugging later.",
    ];

    return {
      kind: "break",
      title: "bro step away from the keyboard",
      message:
        memeMessages[
          recoveryState.activeBreak.cycle % memeMessages.length
        ],
      endsAt: recoveryState.activeBreak.endsAt,
      unlockTimeLabel: formatClockTime(recoveryState.activeBreak.endsAt),
      allowPhraseUnlock: recoveryState.activeBreak.allowPhraseUnlock,
      unlockPhrase: settings.earlyUnlockPhrase,
      sound: SOUND_FILES.breakStart[0] ?? "",
      showDevBypass: DEV_MODE,
    };
  }

  if (recoveryState.mode === "SHUTDOWN" && recoveryState.shutdown) {
    return {
      kind: "shutdown",
      title: "you're done for today",
      message: `Shutdown lock until ${formatClockTime(recoveryState.shutdown.unlockAt)}.`,
      endsAt: recoveryState.shutdown.unlockAt,
      unlockTimeLabel: formatClockTime(recoveryState.shutdown.unlockAt),
      allowPhraseUnlock: false,
      unlockPhrase: settings.earlyUnlockPhrase,
      sound: SOUND_FILES.shutdown[0] ?? "",
      showDevBypass: DEV_MODE,
    };
  }

  return null;
}

async function redirectTabToLockedPage(tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { url: getLockedPageUrl() });
  } catch (error) {
    log("redirect skipped", tabId, error);
  }
}

async function enforceLockOnTab(tab: chrome.tabs.Tab, appState: StoredAppState): Promise<void> {
  if (!tab.id || !isLockedMode(appState)) {
    return;
  }

  const tabUrl = tab.pendingUrl ?? tab.url ?? "";

  if (!tabUrl || NEW_TAB_PROTOCOLS.some((prefix) => tabUrl.startsWith(prefix))) {
    await redirectTabToLockedPage(tab.id);
    return;
  }

  if (isExtensionPage(tabUrl)) {
    return;
  }

  await redirectTabToLockedPage(tab.id);
}

async function scheduleAlarm(name: string, when: number): Promise<void> {
  await chrome.alarms.create(name, { when });
  log("alarm scheduled", name, new Date(when).toISOString());
}

async function scheduleDailyAlarms(settings: UserSettings): Promise<void> {
  if (!settings.hardShutdownTime || !settings.workStartTime) {
    await chrome.alarms.clear(ALARM_NAMES.DAILY_SHUTDOWN);
    await chrome.alarms.clear(ALARM_NAMES.DAILY_UNLOCK);
    return;
  }

  await scheduleAlarm(ALARM_NAMES.DAILY_SHUTDOWN, getNextOccurrence(settings.hardShutdownTime));
  await scheduleAlarm(ALARM_NAMES.DAILY_UNLOCK, getNextOccurrence(settings.workStartTime));
}

async function clearWorkAndBreakAlarms(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.WORK_END);
  await chrome.alarms.clear(ALARM_NAMES.BREAK_END);
}

async function syncOverlayToTab(
  tab: chrome.tabs.Tab,
  payload: OverlayPayload | null,
): Promise<void> {
  if (!tab.id || !isTabScriptable(tab)) {
    return;
  }

  if (payload) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: [OVERLAY_ASSETS.style],
      });
    } catch (error) {
      log("insertCSS skipped", tab.id, error);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [OVERLAY_ASSETS.script],
      });
    } catch (error) {
      log("executeScript skipped", tab.id, error);
    }
  }

  try {
    const message: OverlaySyncMessage = {
      type: "OVERLAY_SYNC",
      payload,
    };
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    log("overlay message skipped", tab.id, error);
  }
}

async function syncOverlayEverywhere(appState: StoredAppState): Promise<void> {
  const payload = getOverlayPayload(appState);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => syncOverlayToTab(tab, payload)));
}

async function redirectActiveTabToCheckIn(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (activeTab?.id) {
    await redirectTabToLockedPage(activeTab.id);
  }
}

async function writeAppState(appState: StoredAppState): Promise<void> {
  await setStoredAppState(appState);
  await syncOverlayEverywhere(appState);
}

async function startWorkingFromState(
  appState: StoredAppState,
  cycle: number,
  goalSnapshot: string,
  sessionId?: ActiveSession["id"],
  remainingMs?: number,
): Promise<StoredAppState> {
  const activeSession = createWorkingSession(
    appState,
    cycle,
    goalSnapshot,
    sessionId,
    remainingMs,
  );
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "WORKING",
      activeSession,
      pausedWork: null,
      activeBreak: null,
      checkIn: null,
      shutdown: null,
      lastUpdatedAt: Date.now(),
    },
  };

  await clearWorkAndBreakAlarms();
  await scheduleAlarm(ALARM_NAMES.WORK_END, activeSession.endsAt);
  await writeAppState(nextState);
  return nextState;
}

async function startWorkingSession(baseState?: StoredAppState): Promise<StoredAppState> {
  const appState = baseState ?? (await getStoredAppState());

  if (appState.recoveryState.mode === "SHUTDOWN") {
    throw new Error("Browser is shut down until your configured start time.");
  }

  if (
    appState.recoveryState.mode === "WORKING" ||
    appState.recoveryState.mode === "BREAK"
  ) {
    return appState;
  }

  const nextState = await startWorkingFromState(
    appState,
    getNextCycleNumber(appState),
    appState.settings.goal,
  );
  return nextState;
}

async function returnToIdle(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "IDLE",
      activeSession: null,
      pausedWork: null,
      activeBreak: null,
      checkIn: null,
      shutdown: null,
      lastUpdatedAt: Date.now(),
    },
  };

  await clearWorkAndBreakAlarms();
  await writeAppState(nextState);
  return nextState;
}

async function pauseWorkingSession(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const activeSession = appState.recoveryState.activeSession;

  if (!activeSession) {
    log("pause skipped: no active session", appState.recoveryState.mode);
    return appState;
  }

  const remainingMs = Math.max(1_000, activeSession.endsAt - Date.now());
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "PAUSED",
      activeSession: null,
      pausedWork: {
        sessionId: activeSession.id,
        cycle: activeSession.cycle,
        pausedAt: Date.now(),
        remainingMs,
        goalSnapshot: activeSession.goalSnapshot,
      },
      activeBreak: null,
      checkIn: null,
      shutdown: null,
      lastUpdatedAt: Date.now(),
    },
  };

  await clearWorkAndBreakAlarms();
  await writeAppState(nextState);
  log("state transition", "WORKING", "->", "PAUSED");
  return nextState;
}

async function resumePausedSession(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const pausedWork = appState.recoveryState.pausedWork;

  if (!pausedWork) {
    log("resume skipped: no paused work", appState.recoveryState.mode);
    return appState;
  }

  const nextState = await startWorkingFromState(
    appState,
    pausedWork.cycle,
    pausedWork.goalSnapshot,
    pausedWork.sessionId,
    pausedWork.remainingMs,
  );

  log("state transition", "PAUSED", "->", "WORKING");
  return nextState;
}

async function moveWorkingToBreak(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const activeSession = appState.recoveryState.activeSession;

  if (!activeSession) {
    return appState;
  }

  const now = Date.now();
  const completedSession = createCompletedSession(appState, now);
  const nextState: StoredAppState = {
    ...appState,
    sessionHistory: completedSession
      ? [completedSession, ...appState.sessionHistory].slice(0, 100)
      : appState.sessionHistory,
    recoveryState: {
      mode: "BREAK",
      activeSession: null,
      pausedWork: null,
      activeBreak: {
        sessionId: activeSession.id,
        cycle: activeSession.cycle,
        startedAt: now,
        endsAt: now + getEffectiveBreakDurationMs(appState.settings),
        unlockPhrase: appState.settings.earlyUnlockPhrase,
        allowPhraseUnlock: true,
      },
      checkIn: null,
      shutdown: null,
      lastUpdatedAt: now,
    },
  };

  await clearWorkAndBreakAlarms();
  if (nextState.recoveryState.activeBreak) {
    await scheduleAlarm(ALARM_NAMES.BREAK_END, nextState.recoveryState.activeBreak.endsAt);
  }
  await writeAppState(nextState);
  if (nextState.settings.soundEnabled) {
    const breakStartSound = pickRandomSound("break", SOUND_FILES.breakStart);
    const ambientSound = pickRandomSound("break-ambient", SOUND_FILES.breakAmbient);
    await playManagedSoundThenStartLoop(
      breakStartSound,
      BREAK_AMBIENT_CHANNEL,
      ambientSound,
    );
  } else {
    await syncBreakAmbient(nextState);
  }
  log("state transition", "WORKING", "->", "BREAK");
  return nextState;
}

async function moveBreakToCheckIn(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const activeBreak = appState.recoveryState.activeBreak;

  if (!activeBreak) {
    return appState;
  }

  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "CHECK_IN",
      activeSession: null,
      pausedWork: null,
      activeBreak: null,
      checkIn: {
        sessionId: activeBreak.sessionId,
        cycle: activeBreak.cycle,
        readyAt: Date.now(),
        goalSnapshot: appState.settings.goal,
      },
      shutdown: null,
      lastUpdatedAt: Date.now(),
    },
  };

  await clearWorkAndBreakAlarms();
  await writeAppState(nextState);
  await syncBreakAmbient(nextState);
  if (nextState.settings.soundEnabled) {
    await playManagedSound(pickRandomSound("break-end", SOUND_FILES.breakEnd));
  }
  await redirectActiveTabToCheckIn();
  log("state transition", "BREAK", "->", "CHECK_IN");
  return nextState;
}

async function handleCheckInDecision(action: CheckInAction): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const checkIn = appState.recoveryState.checkIn;

  if (!checkIn) {
    return appState;
  }

  if (action === "stop") {
    log("state transition", "CHECK_IN", "->", "IDLE");
    return returnToIdle();
  }

  const goalSnapshot =
    action === "resume_same_goal" ? checkIn.goalSnapshot : appState.settings.goal;

  const nextState = await startWorkingFromState(
    appState,
    checkIn.cycle + 1,
    goalSnapshot,
  );

  log("state transition", "CHECK_IN", "->", "WORKING", action);
  return nextState;
}

async function enterShutdown(
  existingWindow?: { startsAt: number; endsAt: number },
): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const now = Date.now();
  const unlockAt = existingWindow?.endsAt ?? getNextOccurrence(appState.settings.workStartTime, now);
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "SHUTDOWN",
      activeSession: null,
      pausedWork: null,
      activeBreak: null,
      checkIn: null,
      shutdown: {
        startedAt: existingWindow?.startsAt ?? now,
        unlockAt,
      },
      lastUpdatedAt: now,
    },
  };

  await clearWorkAndBreakAlarms();
  await scheduleAlarm(ALARM_NAMES.DAILY_UNLOCK, unlockAt);
  await scheduleDailyAlarms(appState.settings);
  await writeAppState(nextState);
  await syncBreakAmbient(nextState);
  if (nextState.settings.soundEnabled) {
    await playManagedSound(pickRandomSound("shutdown", SOUND_FILES.shutdown));
  }
  return nextState;
}

async function exitShutdown(): Promise<StoredAppState> {
  const appState = await getStoredAppState();

  if (appState.recoveryState.mode !== "SHUTDOWN") {
    return appState;
  }

  return returnToIdle();
}

async function applySettings(payload: Partial<UserSettings>): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const mergedSettings = sanitizeSettings({
    ...appState.settings,
    ...payload,
  });
  const nextState: StoredAppState = {
    ...appState,
    settings: mergedSettings,
  };

  if (nextState.recoveryState.mode === "SHUTDOWN" && nextState.recoveryState.shutdown) {
    nextState.recoveryState.shutdown.unlockAt = getNextOccurrence(
      mergedSettings.workStartTime,
      Date.now(),
    );
  }

  await scheduleDailyAlarms(mergedSettings);
  await writeAppState(nextState);
  await syncBreakAmbient(nextState);
  return nextState;
}

async function hydrateFromStorage(): Promise<void> {
  const appState = await getStoredAppState();
  const now = Date.now();
  const shutdownWindow = getActiveTimeWindow(
    appState.settings.hardShutdownTime,
    appState.settings.workStartTime,
    now,
  );

  if (shutdownWindow) {
    if (
      appState.recoveryState.mode !== "SHUTDOWN" ||
      appState.recoveryState.shutdown?.unlockAt !== shutdownWindow.endsAt
    ) {
      await enterShutdown(shutdownWindow);
      return;
    }
  } else if (appState.recoveryState.mode === "SHUTDOWN") {
    await exitShutdown();
    return;
  }

  if (appState.recoveryState.mode === "WORKING" && appState.recoveryState.activeSession) {
    if (appState.recoveryState.activeSession.endsAt <= now) {
      await moveWorkingToBreak();
      return;
    }

    await scheduleAlarm(ALARM_NAMES.WORK_END, appState.recoveryState.activeSession.endsAt);
  }

  if (appState.recoveryState.mode === "BREAK" && appState.recoveryState.activeBreak) {
    if (appState.recoveryState.activeBreak.endsAt <= now) {
      await moveBreakToCheckIn();
      return;
    }

    await scheduleAlarm(ALARM_NAMES.BREAK_END, appState.recoveryState.activeBreak.endsAt);
  }

  if (appState.recoveryState.mode === "SHUTDOWN" && appState.recoveryState.shutdown) {
    if (appState.recoveryState.shutdown.unlockAt <= now) {
      await exitShutdown();
      return;
    }

    await scheduleAlarm(ALARM_NAMES.DAILY_UNLOCK, appState.recoveryState.shutdown.unlockAt);
  }

  await scheduleDailyAlarms(appState.settings);
  await syncOverlayEverywhere(appState);
  await syncBreakAmbient(appState);
}

async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  log("alarm fired", alarm.name);

  switch (alarm.name) {
    case ALARM_NAMES.WORK_END:
      await moveWorkingToBreak();
      break;
    case ALARM_NAMES.BREAK_END:
      await moveBreakToCheckIn();
      break;
    case ALARM_NAMES.DAILY_SHUTDOWN:
      await enterShutdown();
      break;
    case ALARM_NAMES.DAILY_UNLOCK:
      await exitShutdown();
      break;
    default:
      break;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void hydrateFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  void hydrateFromStorage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleAlarm(alarm);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tabId) {
    return;
  }

  void getStoredAppState().then((appState) => {
    if (!isLockedMode(appState)) {
      return undefined;
    }

    if (changeInfo.status === "loading" || changeInfo.status === "complete" || changeInfo.url) {
      return enforceLockOnTab(tab, appState);
    }

    return undefined;
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  void getStoredAppState().then((appState) => enforceLockOnTab(tab, appState));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void getStoredAppState().then(async (appState) => {
    if (!isLockedMode(appState)) {
      return;
    }

    const tab = await chrome.tabs.get(tabId);
    await enforceLockOnTab(tab, appState);
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeRequestMessage,
    _sender,
    sendResponse: (response: RuntimeResponseMessage) => void,
  ) => {
    void (async () => {
      try {
        switch (message.type) {
          case "GET_APP_STATE":
            sendResponse({ ok: true, appState: await getStoredAppState() });
            return;
          case "GET_OVERLAY_STATUS":
            sendResponse({
              ok: true,
              overlay: getOverlayPayload(await getStoredAppState()),
            });
            return;
          case "START_SESSION":
            sendResponse({ ok: true, appState: await startWorkingSession() });
            return;
          case "END_SESSION":
            sendResponse({ ok: true, appState: await returnToIdle() });
            return;
          case "PAUSE_SESSION":
            sendResponse({ ok: true, appState: await pauseWorkingSession() });
            return;
          case "RESUME_SESSION":
            sendResponse({ ok: true, appState: await resumePausedSession() });
            return;
          case "CHECK_IN_DECISION":
            sendResponse({ ok: true, appState: await handleCheckInDecision(message.action) });
            return;
          case "UPDATE_SETTINGS":
            sendResponse({ ok: true, appState: await applySettings(message.payload) });
            return;
          case "UNLOCK_BREAK_EARLY": {
            const appState = await getStoredAppState();
            const activeBreak = appState.recoveryState.activeBreak;
            const phraseMatches =
              activeBreak &&
              message.phrase.trim().toLowerCase() ===
                activeBreak.unlockPhrase.trim().toLowerCase();

            if (!phraseMatches) {
              sendResponse({ ok: false, error: "Phrase did not match." });
              return;
            }

            sendResponse({ ok: true, appState: await moveBreakToCheckIn() });
            return;
          }
          case "DISMISS_OVERLAY_DEV": {
            if (!DEV_MODE) {
              sendResponse({ ok: false, error: "DEV_MODE is disabled." });
              return;
            }

            const appState = await getStoredAppState();

            if (appState.recoveryState.mode === "BREAK") {
              sendResponse({ ok: true, appState: await moveBreakToCheckIn() });
              return;
            }

            if (appState.recoveryState.mode === "SHUTDOWN") {
              sendResponse({ ok: true, appState: await returnToIdle() });
              return;
            }

            sendResponse({ ok: true, appState });
            return;
          }
          default:
            sendResponse({ ok: false, error: "Unknown message type." });
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unexpected error";
        sendResponse({ ok: false, error: messageText });
      }
    })();

    return true;
  },
);

void hydrateFromStorage();
