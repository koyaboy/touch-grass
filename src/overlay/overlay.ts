import "./overlay.css";

import type {
  OverlayPayload,
  OverlaySyncMessage,
  RuntimeResponseMessage,
} from "../types";
import { formatDuration } from "../utils/time";

declare global {
  interface Window {
    __touchGrassOverlayMounted?: boolean;
  }
}

const ROOT_ID = "touch-grass-overlay-root";

let currentPayload: OverlayPayload | null = null;
let tickerId: number | null = null;
let lastSoundKey = "";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRoot(): HTMLDivElement {
  let root = document.getElementById(ROOT_ID) as HTMLDivElement | null;

  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.append(root);
  }

  return root;
}

function playSound(soundPath: string): void {
  if (!soundPath || soundPath === lastSoundKey) {
    return;
  }

  lastSoundKey = soundPath;

  const audio = new Audio(chrome.runtime.getURL(soundPath));
  void audio.play().catch(() => undefined);
}

function ensureRootPersistence(): void {
  const observer = new MutationObserver(() => {
    if (!currentPayload) {
      return;
    }

    if (!document.getElementById(ROOT_ID)) {
      document.documentElement.append(getRoot());
      render(currentPayload);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

async function request<T>(message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponseMessage) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }

      resolve(response as T);
    });
  });
}

async function handlePhraseSubmit(event: Event): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget as HTMLFormElement;
  const input = form.querySelector("input") as HTMLInputElement | null;
  const error = form.querySelector("[data-role='phrase-error']") as HTMLElement | null;

  if (!input || !currentPayload) {
    return;
  }

  try {
    await request({ type: "UNLOCK_BREAK_EARLY", phrase: input.value });
    input.value = "";
  } catch (requestError) {
    if (error) {
      error.textContent =
        requestError instanceof Error ? requestError.message : "Unlock failed.";
    }
  }
}

async function handleDevBypass(): Promise<void> {
  try {
    await request({ type: "DISMISS_OVERLAY_DEV" });
  } catch {
    return;
  }
}

function render(payload: OverlayPayload | null): void {
  currentPayload = payload;
  const root = getRoot();

  if (!payload) {
    root.innerHTML = "";
    root.className = "";
    document.documentElement.classList.remove("touch-grass-overlay-active");
    document.body?.classList.remove("touch-grass-overlay-active");
    if (tickerId) {
      window.clearInterval(tickerId);
      tickerId = null;
    }
    return;
  }

  document.documentElement.classList.add("touch-grass-overlay-active");
  document.body?.classList.add("touch-grass-overlay-active");
  root.className = `tg-overlay-root tg-overlay-root--${payload.kind}`;
  root.innerHTML = `
    <section class="tg-overlay-shell tg-overlay-shell--${payload.kind}">
      <div class="tg-overlay-noise"></div>
      <div class="tg-overlay-card">
        <p class="tg-overlay-kicker">${payload.kind === "break" ? "MANDATORY BREAK" : "DAILY SHUTDOWN"}</p>
        <h1 class="tg-overlay-title">${payload.title}</h1>
        <p class="tg-overlay-message">${payload.message}</p>
        <div class="tg-overlay-badge-row">
          ${
            payload.kind === "break"
              ? `
            <span class="tg-overlay-badge">hydrate</span>
            <span class="tg-overlay-badge">walk around</span>
            <span class="tg-overlay-badge">your code can wait</span>
          `
              : `
            <span class="tg-overlay-badge">close the laptop</span>
            <span class="tg-overlay-badge">tomorrow has a start time</span>
          `
          }
        </div>
        <div class="tg-overlay-countdown" data-role="countdown">${formatDuration(payload.endsAt - Date.now())}</div>
        <p class="tg-overlay-meta">
          ${payload.kind === "break" ? `Returns at ${payload.unlockTimeLabel}` : `Unlocked at ${payload.unlockTimeLabel}`}
        </p>
        ${
          payload.allowPhraseUnlock
            ? `
          <form class="tg-overlay-form" data-role="phrase-form">
            <label class="tg-overlay-label" for="tg-break-phrase">Type the phrase to unlock early</label>
            <input
              id="tg-break-phrase"
              class="tg-overlay-input"
              name="phrase"
              type="text"
              autocomplete="off"
              placeholder="${escapeHtml(payload.unlockPhrase)}"
            />
            <button class="tg-overlay-button" type="submit">Unlock early</button>
            <p class="tg-overlay-error" data-role="phrase-error"></p>
          </form>
        `
            : ""
        }
        ${
          payload.showDevBypass
            ? `
          <button class="tg-overlay-dev-button" type="button" data-role="dev-bypass">
            DEV BYPASS — skip break
          </button>
        `
            : ""
        }
      </div>
    </section>
  `;

  const form = root.querySelector("[data-role='phrase-form']") as HTMLFormElement | null;
  const devBypass = root.querySelector("[data-role='dev-bypass']") as HTMLButtonElement | null;

  if (form) {
    form.addEventListener("submit", (event) => {
      void handlePhraseSubmit(event);
    });
  }

  if (devBypass) {
    devBypass.addEventListener("click", () => {
      void handleDevBypass();
    });
  }

  playSound(payload.sound);

  if (tickerId) {
    window.clearInterval(tickerId);
  }

  tickerId = window.setInterval(() => {
    const countdown = root.querySelector("[data-role='countdown']");
    if (countdown instanceof HTMLElement && currentPayload) {
      countdown.textContent = formatDuration(currentPayload.endsAt - Date.now());
    }
  }, 1000);
}

async function bootstrap(): Promise<void> {
  if (window.__touchGrassOverlayMounted) {
    return;
  }

  window.__touchGrassOverlayMounted = true;
  ensureRootPersistence();

  try {
    const response = await request<{ ok: true; overlay?: OverlayPayload | null }>({
      type: "GET_OVERLAY_STATUS",
    });
    render(response.overlay ?? null);
  } catch {
    render(null);
  }

  chrome.runtime.onMessage.addListener((message: OverlaySyncMessage) => {
    if (message.type === "OVERLAY_SYNC") {
      render(message.payload);
    }
  });
}

void bootstrap();
