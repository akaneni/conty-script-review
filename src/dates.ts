const TIME_ZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia civil (YYYY-MM-DD) em America/Sao_Paulo. */
export function todayInSaoPaulo(now: Date): string {
  return formatter.format(now);
}

export type DueDateCheck =
  | { ok: true; value: string }
  | { ok: false; kind: "invalid" | "past" };

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Prazo é um dia civil de SP; vale se for hoje ou depois (o dia inteiro vale). */
export function checkDueDate(value: unknown, now: Date): DueDateCheck {
  if (typeof value !== "string" || !isRealCalendarDate(value)) return { ok: false, kind: "invalid" };
  if (value < todayInSaoPaulo(now)) return { ok: false, kind: "past" };
  return { ok: true, value };
}
