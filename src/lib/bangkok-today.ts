const BANGKOK_OFFSET = 7 * 60 * 60 * 1000;

/** The Bangkok calendar day ("YYYY-MM-DD") an instant falls on. Thailand has no DST, so a fixed +7h is exact. */
export const bangkokDayKey = (instant: Date = new Date()) => new Date(instant.getTime() + BANGKOK_OFFSET).toISOString().slice(0, 10);

/**
 * Today in Bangkok: the calendar key (event days are stored as UTC dates, so `date` is that day at 00:00 UTC) and the
 * instant the day starts (for check-in times).
 */
export function bangkokToday() {
  const key = bangkokDayKey();
  return { key, date: new Date(`${key}T00:00:00Z`), start: new Date(`${key}T00:00:00+07:00`) };
}
