const DATE_FORMATTERS = new Map();

function dateFormatter(timezone) {
  let formatter = DATE_FORMATTERS.get(timezone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    DATE_FORMATTERS.set(timezone, formatter);
  }

  return formatter;
}

export function zonedParts(date, timezone) {
  const parts = dateFormatter(timezone).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function dateKey(date, timezone) {
  const values = zonedParts(date, timezone);
  return `${values.year}-${values.month}-${values.day}`;
}

export function monthKey(date, timezone) {
  return dateKey(date, timezone).slice(0, 7);
}

export function shiftDateKey(date, delta) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function nextDateKey(date) {
  return shiftDateKey(date, 1);
}

export function previousDateKey(date) {
  return shiftDateKey(date, -1);
}

export function nextMonthKey(month) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const next = monthNumber === 12 ? { year: year + 1, month: 1 } : { year, month: monthNumber + 1 };

  return `${next.year}-${String(next.month).padStart(2, "0")}`;
}

export function getTimezoneOffsetMs(date, timezone) {
  const values = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

export function zonedDateStartIso(date, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = getTimezoneOffsetMs(localAsUtc, timezone);
  return new Date(localAsUtc.getTime() - offset).toISOString();
}

export function dailyRange(date, timezone) {
  const startIso = zonedDateStartIso(date, timezone);
  const endDate = nextDateKey(date);
  const endIso = zonedDateStartIso(endDate, timezone);
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  return {
    startDate: date,
    endDate,
    startIso,
    endIso,
    startTs: Math.floor(startMs / 1000),
    endTs: Math.floor(endMs / 1000),
    startMs,
    endMs
  };
}
