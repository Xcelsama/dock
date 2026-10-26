/** The home list shows today and yesterday, by the device's own calendar. */
export function startOfYesterday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d;
}
