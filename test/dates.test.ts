import { describe, expect, it } from "vitest";
import { checkDueDate, todayInSaoPaulo } from "../src/dates.ts";

describe("todayInSaoPaulo", () => {
  it("usa o dia civil de São Paulo, não o dia UTC", () => {
    expect(todayInSaoPaulo(new Date("2026-03-13T02:59:59.999Z"))).toBe("2026-03-12");
    expect(todayInSaoPaulo(new Date("2026-03-13T03:00:00.000Z"))).toBe("2026-03-13");
  });
  it("não vira o dia às 21h de SP, quando o UTC já virou", () => {
    expect(todayInSaoPaulo(new Date("2026-03-12T23:30:00.000Z"))).toBe("2026-03-12");
  });
});

describe("checkDueDate", () => {
  const now = new Date("2026-03-13T02:59:59.999Z"); // 23:59:59.999 de 12/03 em SP
  it("aceita o dia de hoje em SP no último instante", () => {
    expect(checkDueDate("2026-03-12", now)).toEqual({ ok: true, value: "2026-03-12" });
  });
  it("recusa o dia de ontem em SP no primeiro instante do dia seguinte", () => {
    const next = new Date("2026-03-13T03:00:00.000Z");
    expect(checkDueDate("2026-03-12", next)).toEqual({ ok: false, kind: "past" });
  });
  it.each([undefined, null, 20260312, "", "12/03/2026", "2026-3-12", "2026-02-30", "2026-13-01", "2026-03-12T10:00:00Z"])(
    "recusa formato inválido %j",
    (v) => {
      expect(checkDueDate(v, now)).toEqual({ ok: false, kind: "invalid" });
    },
  );
});
