import { SOUND_VOLUME } from "../config";
import type { OffscreenRuntimeMessage } from "../types";

const activeAudio = new Set<HTMLAudioElement>();
const loopAudioByChannel = new Map<string, HTMLAudioElement>();

function cleanupAudio(audio: HTMLAudioElement): void {
  activeAudio.delete(audio);
  audio.onended = null;
  audio.onerror = null;
}

function stopAudio(audio: HTMLAudioElement): void {
  audio.pause();
  audio.currentTime = 0;
  cleanupAudio(audio);
}

function stopChannel(channel: string): void {
  const audio = loopAudioByChannel.get(channel);

  if (!audio) {
    return;
  }

  loopAudioByChannel.delete(channel);
  stopAudio(audio);
}

function stopAllAudio(): void {
  for (const channel of loopAudioByChannel.keys()) {
    stopChannel(channel);
  }

  for (const audio of [...activeAudio]) {
    stopAudio(audio);
  }
}

function playSound(path: string, maxDurationMs?: number, volume = SOUND_VOLUME): void {
  if (!path) {
    return;
  }

  const audio = new Audio(chrome.runtime.getURL(path));
  audio.volume = volume;

  activeAudio.add(audio);
  audio.onended = () => cleanupAudio(audio);
  audio.onerror = () => cleanupAudio(audio);

  if (maxDurationMs && maxDurationMs > 0) {
    window.setTimeout(() => {
      stopAudio(audio);
    }, maxDurationMs);
  }

  void audio.play().catch(() => {
    cleanupAudio(audio);
  });
}

function startLoop(channel: string, path: string, volume = SOUND_VOLUME): void {
  if (!path) {
    return;
  }

  stopChannel(channel);

  const audio = new Audio(chrome.runtime.getURL(path));
  audio.loop = true;
  audio.volume = volume;
  activeAudio.add(audio);
  loopAudioByChannel.set(channel, audio);
  audio.onerror = () => {
    if (loopAudioByChannel.get(channel) === audio) {
      loopAudioByChannel.delete(channel);
    }
    cleanupAudio(audio);
  };

  void audio.play().catch(() => {
    if (loopAudioByChannel.get(channel) === audio) {
      loopAudioByChannel.delete(channel);
    }
    cleanupAudio(audio);
  });
}

function playSoundThenStartLoop(
  path: string,
  channel: string,
  loopPath: string,
  volume = SOUND_VOLUME,
  loopVolume = SOUND_VOLUME,
): void {
  if (!path || !loopPath) {
    return;
  }

  stopChannel(channel);

  const audio = new Audio(chrome.runtime.getURL(path));
  audio.volume = volume;
  activeAudio.add(audio);
  audio.onended = () => {
    cleanupAudio(audio);
    startLoop(channel, loopPath, loopVolume);
  };
  audio.onerror = () => cleanupAudio(audio);

  void audio.play().catch(() => {
    cleanupAudio(audio);
  });
}

chrome.runtime.onMessage.addListener((message: OffscreenRuntimeMessage) => {
  if (message.target !== "offscreen") {
    return;
  }

  switch (message.type) {
    case "PLAY_SOUND":
      playSound(message.path, message.maxDurationMs, message.volume);
      return;
    case "START_LOOP":
      startLoop(message.channel, message.path, message.volume);
      return;
    case "PLAY_SOUND_THEN_START_LOOP":
      playSoundThenStartLoop(
        message.path,
        message.channel,
        message.loopPath,
        message.volume,
        message.loopVolume,
      );
      return;
    case "STOP_CHANNEL":
      stopChannel(message.channel);
      return;
    case "STOP_ALL":
      stopAllAudio();
      return;
    default:
      return;
  }
});
