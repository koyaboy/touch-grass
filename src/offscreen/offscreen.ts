import { SOUND_VOLUME } from "../config";
import type { OffscreenRuntimeMessage } from "../types";

const activeAudio = new Set<HTMLAudioElement>();

function playSound(path: string, maxDurationMs?: number): void {
  if (!path) {
    return;
  }

  const audio = new Audio(chrome.runtime.getURL(path));
  audio.volume = SOUND_VOLUME;

  const cleanup = (): void => {
    activeAudio.delete(audio);
    audio.onended = null;
    audio.onerror = null;
  };

  activeAudio.add(audio);
  audio.onended = cleanup;
  audio.onerror = cleanup;

  if (maxDurationMs && maxDurationMs > 0) {
    window.setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
      cleanup();
    }, maxDurationMs);
  }

  void audio.play().catch(() => {
    cleanup();
  });
}

chrome.runtime.onMessage.addListener((message: OffscreenRuntimeMessage) => {
  if (message.target !== "offscreen" || message.type !== "PLAY_SOUND") {
    return;
  }

  playSound(message.path, message.maxDurationMs);
});
