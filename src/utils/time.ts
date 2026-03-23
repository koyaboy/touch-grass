export function parseClockTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return { hours: 8, minutes: 0 };
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  return {
    hours: Number.isFinite(hours) ? Math.max(0, Math.min(23, hours)) : 8,
    minutes: Number.isFinite(minutes) ? Math.max(0, Math.min(59, minutes)) : 0,
  };
}

export function getNextOccurrence(time: string, from = Date.now()): number {
  const { hours, minutes } = parseClockTime(time);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= from) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

export function startOfLocalDay(timestamp = Date.now()): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function isSameLocalDay(left: number, right: number): boolean {
  return startOfLocalDay(left) === startOfLocalDay(right);
}

export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatShortDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}
