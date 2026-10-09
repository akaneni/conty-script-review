import { describe, expect, it } from "vitest";
import { canAct, decideApprove, decideNewVersion, decideRequestChange, isOverdue } from "../src/domain.ts";

describe("canAct", () => {
  it("só o criador cria e envia versão; só a marca pede e aprova", () => {
    expect(canAct("creator", "create")).toBe(true);
    expect(canAct("brand", "create")).toBe(false);
    expect(canAct("creator", "submit_version")).toBe(true);
    expect(canAct("brand", "submit_version")).toBe(false);
    expect(canAct("brand", "request_change")).toBe(true);
    expect(canAct("creator", "request_change")).toBe(false);
    expect(canAct("brand", "approve")).toBe(true);
    expect(canAct("creator", "approve")).toBe(false);
    expect(canAct(null, "approve")).toBe(false);
  });
});

describe("transições", () => {
  it("pedido só a partir de awaiting_review", () => {
    expect(decideRequestChange("awaiting_review")).toEqual({ ok: true, next: "changes_requested" });
    expect(decideRequestChange("changes_requested").ok).toBe(false);
    expect(decideRequestChange("approved").ok).toBe(false);
  });
  it("aprovação só a partir de awaiting_review", () => {
    expect(decideApprove("awaiting_review")).toEqual({ ok: true, next: "approved" });
    expect(decideApprove("changes_requested").ok).toBe(false);
    expect(decideApprove("approved").ok).toBe(false);
  });
  it("nova versão só com pedido aberto", () => {
    expect(decideNewVersion("changes_requested")).toEqual({ ok: true, next: "awaiting_review" });
    expect(decideNewVersion("awaiting_review").ok).toBe(false);
    expect(decideNewVersion("approved").ok).toBe(false);
  });
  it("aprovado explica que a aprovação não reabre", () => {
    const r = decideNewVersion("approved");
    expect(r.ok === false && r.message).toMatch(/aprova/i);
  });
});

describe("isOverdue", () => {
  const due = "2026-03-12";
  it("é falso sem pedido aberto", () => {
    expect(isOverdue(null, new Date("2026-04-01T00:00:00Z"))).toBe(false);
  });
  it("é falso até o último instante do dia em SP e verdadeiro depois", () => {
    expect(isOverdue(due, new Date("2026-03-13T02:59:59.999Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-03-13T03:00:00.000Z"))).toBe(true);
  });
});
