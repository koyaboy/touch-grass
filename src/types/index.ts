export type ExtensionMode =
  | "IDLE"
  | "WORKING"
  | "PAUSED"
  | "BREAK"
  | "CHECK_IN"
  | "SHUTDOWN";
export type OverlayKind = "break" | "shutdown";
export type CheckInAction = "resume_same_goal" | "resume_new_goal" | "stop";

export interface UserSettings {
  goal: string;
  workDurationMinutes: number;
  breakDurationMinutes: number;
  hardShutdownTime: string;
  workStartTime: string;
  earlyUnlockPhrase: string;
  soundEnabled: boolean;
  onboardingCompleted: boolean;
}

export interface SessionHistoryItem {
  id: string;
  cycle: number;
  startedAt: number;
  completedAt: number;
  workDurationMinutes: number;
  breakDurationMinutes: number;
  goalSnapshot: string;
}

export interface ActiveSession {
  id: string;
  cycle: number;
  startedAt: number;
  endsAt: number;
  goalSnapshot: string;
}

export interface ActiveBreak {
  sessionId: string;
  cycle: number;
  startedAt: number;
  endsAt: number;
  unlockPhrase: string;
  allowPhraseUnlock: boolean;
}

export interface ShutdownWindow {
  startedAt: number;
  unlockAt: number;
}

export interface PausedWork {
  sessionId: string;
  cycle: number;
  pausedAt: number;
  remainingMs: number;
  goalSnapshot: string;
}

export interface CheckInPrompt {
  sessionId: string;
  cycle: number;
  readyAt: number;
  goalSnapshot: string;
}

export interface RecoveryState {
  mode: ExtensionMode;
  activeSession: ActiveSession | null;
  pausedWork: PausedWork | null;
  activeBreak: ActiveBreak | null;
  checkIn: CheckInPrompt | null;
  shutdown: ShutdownWindow | null;
  lastUpdatedAt: number;
}

export interface StoredAppState {
  settings: UserSettings;
  recoveryState: RecoveryState;
  sessionHistory: SessionHistoryItem[];
}

export interface OverlayPayload {
  kind: OverlayKind;
  title: string;
  message: string;
  endsAt: number;
  unlockTimeLabel: string;
  allowPhraseUnlock: boolean;
  unlockPhrase: string;
  sound: string;
  showDevBypass: boolean;
}

export type RuntimeRequestMessage =
  | { type: "GET_APP_STATE" }
  | { type: "GET_OVERLAY_STATUS" }
  | { type: "START_SESSION" }
  | { type: "END_SESSION" }
  | { type: "PAUSE_SESSION" }
  | { type: "RESUME_SESSION" }
  | { type: "CHECK_IN_DECISION"; action: CheckInAction }
  | { type: "DISMISS_OVERLAY_DEV" }
  | { type: "UNLOCK_BREAK_EARLY"; phrase: string }
  | { type: "UPDATE_SETTINGS"; payload: Partial<UserSettings> }
  | {
      target: "service-worker";
      type: "BADGE_TICK";
      text: string;
      color: string;
    };

export type RuntimeResponseMessage =
  | { ok: true; appState?: StoredAppState; overlay?: OverlayPayload | null }
  | { ok: false; error: string };

export interface OverlaySyncMessage {
  type: "OVERLAY_SYNC";
  payload: OverlayPayload | null;
}

export type OffscreenRuntimeMessage =
  | {
      target: "offscreen";
      type: "PLAY_SOUND";
      path: string;
      maxDurationMs?: number;
      volume?: number;
    }
  | {
      target: "offscreen";
      type: "START_LOOP";
      channel: string;
      path: string;
      volume?: number;
    }
  | {
      target: "offscreen";
      type: "PLAY_SOUND_THEN_START_LOOP";
      path: string;
      channel: string;
      loopPath: string;
      volume?: number;
      loopVolume?: number;
    }
  | {
      target: "offscreen";
      type: "STOP_CHANNEL";
      channel: string;
    }
  | {
      target: "offscreen";
      type: "STOP_ALL";
    }
  | {
      target: "offscreen";
      type: "SYNC_BADGE";
      mode: ExtensionMode;
      endsAt?: number;
    };
