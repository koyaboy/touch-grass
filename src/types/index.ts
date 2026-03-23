export type ExtensionMode = "IDLE" | "WORKING" | "BREAK" | "SHUTDOWN";
export type OverlayKind = "break" | "shutdown";

export interface UserSettings {
  goal: string;
  workDurationMinutes: number;
  breakDurationMinutes: number;
  hardShutdownTime: string;
  workStartTime: string;
  earlyUnlockPhrase: string;
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

export interface RecoveryState {
  mode: ExtensionMode;
  activeSession: ActiveSession | null;
  activeBreak: ActiveBreak | null;
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
  | { type: "DISMISS_OVERLAY_DEV" }
  | { type: "UNLOCK_BREAK_EARLY"; phrase: string }
  | { type: "UPDATE_SETTINGS"; payload: Partial<UserSettings> };

export type RuntimeResponseMessage =
  | { ok: true; appState?: StoredAppState; overlay?: OverlayPayload | null }
  | { ok: false; error: string };

export interface OverlaySyncMessage {
  type: "OVERLAY_SYNC";
  payload: OverlayPayload | null;
}
