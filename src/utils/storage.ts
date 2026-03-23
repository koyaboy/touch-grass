import { DEFAULT_SETTINGS, STORAGE_KEY } from "../config";
import type {
  RecoveryState,
  SessionHistoryItem,
  StoredAppState,
  UserSettings,
} from "../types";
import { isSameLocalDay } from "./time";

function createDefaultRecoveryState(): RecoveryState {
  return {
    mode: "IDLE",
    activeSession: null,
    activeBreak: null,
    shutdown: null,
    lastUpdatedAt: Date.now(),
  };
}

export function createDefaultAppState(): StoredAppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    recoveryState: createDefaultRecoveryState(),
    sessionHistory: [],
  };
}

function sanitizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function sanitizeTimeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function sanitizeSettings(raw: Partial<UserSettings> | undefined): UserSettings {
  const sanitizedGoal = sanitizeText(raw?.goal, DEFAULT_SETTINGS.goal);

  return {
    goal: sanitizedGoal === "Protect my energy" ? DEFAULT_SETTINGS.goal : sanitizedGoal,
    workDurationMinutes: sanitizePositiveInteger(
      raw?.workDurationMinutes,
      DEFAULT_SETTINGS.workDurationMinutes,
    ),
    breakDurationMinutes: sanitizePositiveInteger(
      raw?.breakDurationMinutes,
      DEFAULT_SETTINGS.breakDurationMinutes,
    ),
    hardShutdownTime: sanitizeTimeString(
      raw?.hardShutdownTime,
      DEFAULT_SETTINGS.hardShutdownTime,
    ),
    workStartTime: sanitizeTimeString(raw?.workStartTime, DEFAULT_SETTINGS.workStartTime),
    earlyUnlockPhrase: sanitizeText(
      raw?.earlyUnlockPhrase,
      DEFAULT_SETTINGS.earlyUnlockPhrase,
    ),
  };
}

function sanitizeSessionHistory(raw: unknown): SessionHistoryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const candidate = item as Partial<SessionHistoryItem>;
      return {
        id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
        cycle: sanitizePositiveInteger(candidate.cycle, 1),
        startedAt: Number(candidate.startedAt) || Date.now(),
        completedAt: Number(candidate.completedAt) || Date.now(),
        workDurationMinutes: sanitizePositiveInteger(candidate.workDurationMinutes, 1),
        breakDurationMinutes: sanitizePositiveInteger(candidate.breakDurationMinutes, 1),
        goalSnapshot: sanitizeText(candidate.goalSnapshot, DEFAULT_SETTINGS.goal),
      };
    })
    .sort((left, right) => right.completedAt - left.completedAt);
}

export function normalizeAppState(raw: unknown): StoredAppState {
  if (!raw || typeof raw !== "object") {
    return createDefaultAppState();
  }

  const candidate = raw as Partial<StoredAppState>;
  const recoveryState = candidate.recoveryState ?? createDefaultRecoveryState();

  return {
    settings: sanitizeSettings(candidate.settings),
    recoveryState: {
      mode:
        recoveryState.mode === "WORKING" ||
        recoveryState.mode === "BREAK" ||
        recoveryState.mode === "SHUTDOWN"
          ? recoveryState.mode
          : "IDLE",
      activeSession: recoveryState.activeSession
        ? {
            id:
              typeof recoveryState.activeSession.id === "string"
                ? recoveryState.activeSession.id
                : crypto.randomUUID(),
            cycle: sanitizePositiveInteger(recoveryState.activeSession.cycle, 1),
            startedAt: Number(recoveryState.activeSession.startedAt) || Date.now(),
            endsAt: Number(recoveryState.activeSession.endsAt) || Date.now(),
            goalSnapshot: sanitizeText(
              recoveryState.activeSession.goalSnapshot,
              DEFAULT_SETTINGS.goal,
            ),
          }
        : null,
      activeBreak: recoveryState.activeBreak
        ? {
            sessionId:
              typeof recoveryState.activeBreak.sessionId === "string"
                ? recoveryState.activeBreak.sessionId
                : crypto.randomUUID(),
            cycle: sanitizePositiveInteger(recoveryState.activeBreak.cycle, 1),
            startedAt: Number(recoveryState.activeBreak.startedAt) || Date.now(),
            endsAt: Number(recoveryState.activeBreak.endsAt) || Date.now(),
            unlockPhrase: sanitizeText(
              recoveryState.activeBreak.unlockPhrase,
              DEFAULT_SETTINGS.earlyUnlockPhrase,
            ),
            allowPhraseUnlock: recoveryState.activeBreak.allowPhraseUnlock !== false,
          }
        : null,
      shutdown: recoveryState.shutdown
        ? {
            startedAt: Number(recoveryState.shutdown.startedAt) || Date.now(),
            unlockAt: Number(recoveryState.shutdown.unlockAt) || Date.now(),
          }
        : null,
      lastUpdatedAt: Number(recoveryState.lastUpdatedAt) || Date.now(),
    },
    sessionHistory: sanitizeSessionHistory(candidate.sessionHistory),
  };
}

export async function getStoredAppState(): Promise<StoredAppState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeAppState(result[STORAGE_KEY]);
}

export async function setStoredAppState(appState: StoredAppState): Promise<void> {
  const normalized = normalizeAppState(appState);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

export async function updateStoredAppState(
  updater: (current: StoredAppState) => StoredAppState | Promise<StoredAppState>,
): Promise<StoredAppState> {
  const current = await getStoredAppState();
  const next = normalizeAppState(await updater(current));
  await setStoredAppState(next);
  return next;
}

export function getTodaySessionHistory(
  sessionHistory: SessionHistoryItem[],
  now = Date.now(),
): SessionHistoryItem[] {
  return sessionHistory.filter((session) => isSameLocalDay(session.completedAt, now));
}
