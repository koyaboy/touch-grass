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
  sessionStart: [
    "sounds/session-start-1.mp3",
    "sounds/session-start-2.mp3",
    "sounds/let-him-cook.mp3",
  ],
  breakStart: ["sounds/break-start.mp3"],
  breakAmbient: ["sounds/lofi-beats/chill-lofi-hip-hop.mp3"],
  breakEnd: ["sounds/fah.mp3", "sounds/sus-meme-sound.mp3"],
  shutdown: ["sounds/shutdown.mp3"],
} as const;

export const SOUND_VOLUME = 0.28;
export const BREAK_AMBIENT_VOLUME = 0.12;

export const DEFAULT_SETTINGS: UserSettings = {
  goal: "",
  workDurationMinutes: DEV_MODE ? 1 : 45,
  breakDurationMinutes: DEV_MODE ? 1 : 15,
  hardShutdownTime: "",
  workStartTime: "05:00",
  earlyUnlockPhrase: "I took a break",
  soundEnabled: true,
};

export function getEffectiveWorkDurationMs(settings: UserSettings): number {
  if (DEV_MODE) {
    return 10_000;
  }

  return settings.workDurationMinutes * 60_000;
}

export function getEffectiveBreakDurationMs(settings: UserSettings): number {
  if (DEV_MODE) {
    return 10_000;
  }

  return settings.breakDurationMinutes * 60_000;
}
