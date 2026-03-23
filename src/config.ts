import type { UserSettings } from "./types";

export const DEV_MODE = true;

export const STORAGE_KEY = "touch-grass-state";

export const ALARM_NAMES = {
  WORK_END: "touch-grass:work-end",
  BREAK_END: "touch-grass:break-end",
  DAILY_SHUTDOWN: "touch-grass:daily-shutdown",
  DAILY_UNLOCK: "touch-grass:daily-unlock",
} as const;

export const OVERLAY_ASSETS = {
  script: "assets/overlay.js",
  style: "assets/overlay.css",
} as const;

export const SOUND_FILES = {
  sessionStart: "sounds/session-start.mp3",
  breakStart: "sounds/break-start.mp3",
  shutdown: "sounds/shutdown.mp3",
} as const;

export const DEFAULT_SETTINGS: UserSettings = {
  goal: "lock in",
  workDurationMinutes: 50,
  breakDurationMinutes: 10,
  hardShutdownTime: "22:00",
  workStartTime: "08:00",
  earlyUnlockPhrase: "I took a break",
};

export function getEffectiveWorkDurationMs(settings: UserSettings): number {
  const minutes = DEV_MODE ? 1 : settings.workDurationMinutes;
  return minutes * 60_000;
}

export function getEffectiveBreakDurationMs(settings: UserSettings): number {
  if (DEV_MODE) {
    return 10_000;
  }

  return settings.breakDurationMinutes * 60_000;
}
