import {
  ALARM_NAMES,
  DEV_MODE,
  OVERLAY_ASSETS,
  SOUND_FILES,
  getEffectiveBreakDurationMs,
  getEffectiveWorkDurationMs,
} from "../config";
import type {
  OverlayPayload,
  OverlaySyncMessage,
  RuntimeRequestMessage,
  RuntimeResponseMessage,
  SessionHistoryItem,
  StoredAppState,
  UserSettings,
} from "../types";
import { getStoredAppState, getTodaySessionHistory, sanitizeSettings, setStoredAppState } from "../utils/storage";
import { formatClockTime, getNextOccurrence } from "../utils/time";

const NON_SCRIPTABLE_PROTOCOLS = ["chrome://", "chrome-extension://", "edge://", "about:"];

function log(...args: unknown[]): void {
  if (DEV_MODE) {
    console.log("[touch-grass]", ...args);
  }
}

function isTabScriptable(tab: chrome.tabs.Tab): boolean {
  if (!tab.id || !tab.url) {
    return false;
  }

  return !NON_SCRIPTABLE_PROTOCOLS.some((protocol) => tab.url?.startsWith(protocol));
}

function getNextCycleNumber(appState: StoredAppState): number {
  return getTodaySessionHistory(appState.sessionHistory).length + 1;
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
    return {
      kind: "break",
      title: "bro step away from the keyboard",
      message: "The timer is not the product. Recovery is the product.",
      endsAt: recoveryState.activeBreak.endsAt,
      unlockTimeLabel: formatClockTime(recoveryState.activeBreak.endsAt),
      allowPhraseUnlock: recoveryState.activeBreak.allowPhraseUnlock,
      unlockPhrase: settings.earlyUnlockPhrase,
      sound: SOUND_FILES.breakStart,
      showDevBypass: DEV_MODE,
    };
  }

  if (recoveryState.mode === "SHUTDOWN" && recoveryState.shutdown) {
    return {
      kind: "shutdown",
      title: "you're done for today",
      message: `Locked until ${formatClockTime(recoveryState.shutdown.unlockAt)}.`,
      endsAt: recoveryState.shutdown.unlockAt,
      unlockTimeLabel: formatClockTime(recoveryState.shutdown.unlockAt),
      allowPhraseUnlock: false,
      unlockPhrase: settings.earlyUnlockPhrase,
      sound: SOUND_FILES.shutdown,
      showDevBypass: DEV_MODE,
    };
  }

  return null;
}

async function scheduleAlarm(name: string, when: number): Promise<void> {
  await chrome.alarms.create(name, { when });
  log("alarm scheduled", name, new Date(when).toISOString());
}

async function scheduleDailyAlarms(settings: UserSettings): Promise<void> {
  await scheduleAlarm(ALARM_NAMES.DAILY_SHUTDOWN, getNextOccurrence(settings.hardShutdownTime));
  await scheduleAlarm(ALARM_NAMES.DAILY_UNLOCK, getNextOccurrence(settings.workStartTime));
}

async function clearWorkAndBreakAlarms(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.WORK_END);
  await chrome.alarms.clear(ALARM_NAMES.BREAK_END);
}

async function syncOverlayToTab(tab: chrome.tabs.Tab, payload: OverlayPayload | null): Promise<void> {
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

async function writeAppState(appState: StoredAppState): Promise<void> {
  await setStoredAppState(appState);
  await syncOverlayEverywhere(appState);
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

  const now = Date.now();
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "WORKING",
      activeSession: {
        id: crypto.randomUUID(),
        cycle: getNextCycleNumber(appState),
        startedAt: now,
        endsAt: now + getEffectiveWorkDurationMs(appState.settings),
        goalSnapshot: appState.settings.goal,
      },
      activeBreak: null,
      shutdown: null,
      lastUpdatedAt: now,
    },
  };
  const scheduledSession = nextState.recoveryState.activeSession;

  await clearWorkAndBreakAlarms();
  if (scheduledSession) {
    await scheduleAlarm(ALARM_NAMES.WORK_END, scheduledSession.endsAt);
  }
  await writeAppState(nextState);
  return nextState;
}

async function returnToIdle(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const now = Date.now();
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "IDLE",
      activeSession: null,
      activeBreak: null,
      shutdown: null,
      lastUpdatedAt: now,
    },
  };

  await clearWorkAndBreakAlarms();
  await writeAppState(nextState);
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
      activeBreak: {
        sessionId: activeSession.id,
        cycle: activeSession.cycle,
        startedAt: now,
        endsAt: now + getEffectiveBreakDurationMs(appState.settings),
        unlockPhrase: appState.settings.earlyUnlockPhrase,
        allowPhraseUnlock: true,
      },
      shutdown: null,
      lastUpdatedAt: now,
    },
  };
  const activeBreak = nextState.recoveryState.activeBreak;

  await clearWorkAndBreakAlarms();
  if (activeBreak) {
    await scheduleAlarm(ALARM_NAMES.BREAK_END, activeBreak.endsAt);
  }
  await writeAppState(nextState);
  return nextState;
}

async function moveBreakToWorking(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const now = Date.now();
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "WORKING",
      activeSession: {
        id: crypto.randomUUID(),
        cycle: (appState.recoveryState.activeBreak?.cycle ?? getNextCycleNumber(appState)) + 1,
        startedAt: now,
        endsAt: now + getEffectiveWorkDurationMs(appState.settings),
        goalSnapshot: appState.settings.goal,
      },
      activeBreak: null,
      shutdown: null,
      lastUpdatedAt: now,
    },
  };
  const scheduledSession = nextState.recoveryState.activeSession;

  await clearWorkAndBreakAlarms();
  if (scheduledSession) {
    await scheduleAlarm(ALARM_NAMES.WORK_END, scheduledSession.endsAt);
  }
  await writeAppState(nextState);
  return nextState;
}

async function enterShutdown(): Promise<StoredAppState> {
  const appState = await getStoredAppState();
  const now = Date.now();
  const unlockAt = getNextOccurrence(appState.settings.workStartTime, now);
  const nextState: StoredAppState = {
    ...appState,
    recoveryState: {
      mode: "SHUTDOWN",
      activeSession: null,
      activeBreak: null,
      shutdown: {
        startedAt: now,
        unlockAt,
      },
      lastUpdatedAt: now,
    },
  };

  await clearWorkAndBreakAlarms();
  await scheduleAlarm(ALARM_NAMES.DAILY_UNLOCK, unlockAt);
  await scheduleDailyAlarms(appState.settings);
  await writeAppState(nextState);
  return nextState;
}

async function exitShutdown(): Promise<StoredAppState> {
  const appState = await getStoredAppState();

  if (appState.recoveryState.mode !== "SHUTDOWN") {
    return appState;
  }

  return returnToIdle();
}

async function applySettings(
  payload: Partial<UserSettings>,
): Promise<StoredAppState> {
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
  return nextState;
}

async function hydrateFromStorage(): Promise<void> {
  const appState = await getStoredAppState();
  const now = Date.now();

  if (appState.recoveryState.mode === "WORKING" && appState.recoveryState.activeSession) {
    if (appState.recoveryState.activeSession.endsAt <= now) {
      await moveWorkingToBreak();
      return;
    }

    await scheduleAlarm(ALARM_NAMES.WORK_END, appState.recoveryState.activeSession.endsAt);
  }

  if (appState.recoveryState.mode === "BREAK" && appState.recoveryState.activeBreak) {
    if (appState.recoveryState.activeBreak.endsAt <= now) {
      await moveBreakToWorking();
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
}

async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  log("alarm fired", alarm.name);

  switch (alarm.name) {
    case ALARM_NAMES.WORK_END:
      await moveWorkingToBreak();
      break;
    case ALARM_NAMES.BREAK_END:
      await moveBreakToWorking();
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
  if (changeInfo.status !== "complete" || !tabId) {
    return;
  }

  void getStoredAppState().then((appState) => {
    if (appState.recoveryState.mode === "BREAK" || appState.recoveryState.mode === "SHUTDOWN") {
      return syncOverlayToTab(tab, getOverlayPayload(appState));
    }

    return undefined;
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
          case "GET_APP_STATE": {
            sendResponse({ ok: true, appState: await getStoredAppState() });
            return;
          }
          case "GET_OVERLAY_STATUS": {
            sendResponse({
              ok: true,
              overlay: getOverlayPayload(await getStoredAppState()),
            });
            return;
          }
          case "START_SESSION": {
            sendResponse({ ok: true, appState: await startWorkingSession() });
            return;
          }
          case "END_SESSION": {
            sendResponse({ ok: true, appState: await returnToIdle() });
            return;
          }
          case "UPDATE_SETTINGS": {
            sendResponse({ ok: true, appState: await applySettings(message.payload) });
            return;
          }
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

            sendResponse({ ok: true, appState: await moveBreakToWorking() });
            return;
          }
          case "DISMISS_OVERLAY_DEV": {
            if (!DEV_MODE) {
              sendResponse({ ok: false, error: "DEV_MODE is disabled." });
              return;
            }

            const appState = await getStoredAppState();

            if (appState.recoveryState.mode === "BREAK") {
              sendResponse({ ok: true, appState: await moveBreakToWorking() });
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
