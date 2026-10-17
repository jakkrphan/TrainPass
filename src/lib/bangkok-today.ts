/**
 * Today in Bangkok: the calendar key (event days are stored as UTC dates, so `date` is that day at 00:00 UTC) and the
 * instant the day starts (for check-in times).
 */
export function bangkokToday() {
  const key = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { key, date: new Date(`${key}T00:00:00Z`), start: new Date(`${key}T00:00:00+07:00`) };
}
