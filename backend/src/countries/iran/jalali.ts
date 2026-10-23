// Shamsi (Jalali) ↔ Gregorian. Persian invoices are dated in the Shamsi
// calendar; the model returns the date as printed and the conversion happens
// here, because models get calendar arithmetic wrong.

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const monthDays = [31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 12 && gd > monthDays[gm]) gd -= monthDays[gm++];
  return [gy, gm + 1, gd];
}

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const daysBeforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + daysBeforeMonth[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as a Shamsi "YYYY/MM/DD", for telling the model which year handwritten digits most likely mean. */
export function todayJalali(now = new Date()): string {
  const [y, m, d] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return `${y}/${pad(m)}/${pad(d)}`;
}

/** "1405/07/26" or "1405-7-26" (Shamsi years 1300-1499) → "2026-10-18"; anything else → null. */
export function jalaliToIso(value: string): string | null {
  const match = /^(1[34]\d\d)[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(value);
  if (!match) return null;
  const [jy, jm, jd] = match.slice(1).map(Number);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}
