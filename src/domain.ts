import { todayInSaoPaulo } from "./dates.ts";

export type Actor = "brand" | "creator";
export type ScriptStatus = "awaiting_review" | "changes_requested" | "approved";
export type Action = "create" | "submit_version" | "request_change" | "approve";

const ALLOWED: Record<Action, Actor> = {
  create: "creator",
  submit_version: "creator",
  request_change: "brand",
  approve: "brand",
};

export function canAct(actor: Actor | null, action: Action): boolean {
  return actor !== null && ALLOWED[action] === actor;
}

export type Transition =
  | { ok: true; next: ScriptStatus }
  | { ok: false; message: string };

const APPROVED_MSG = "roteiro já aprovado; a aprovação não reabre";
const OPEN_REQUEST_MSG = "há um pedido de alteração aberto; o criador precisa enviar uma nova versão antes";

export function decideRequestChange(status: ScriptStatus): Transition {
  if (status === "awaiting_review") return { ok: true, next: "changes_requested" };
  return { ok: false, message: status === "approved" ? APPROVED_MSG : OPEN_REQUEST_MSG };
}

export function decideApprove(status: ScriptStatus): Transition {
  if (status === "awaiting_review") return { ok: true, next: "approved" };
  return { ok: false, message: status === "approved" ? APPROVED_MSG : OPEN_REQUEST_MSG };
}

export function decideNewVersion(status: ScriptStatus): Transition {
  if (status === "changes_requested") return { ok: true, next: "awaiting_review" };
  return {
    ok: false,
    message: status === "approved" ? APPROVED_MSG : "não há pedido de alteração aberto; nova versão não é aceita",
  };
}

/** Derivado: pedido aberto cujo dia (SP) já acabou. Não altera o estado. */
export function isOverdue(openDueDate: string | null, now: Date): boolean {
  return openDueDate !== null && todayInSaoPaulo(now) > openDueDate;
}
