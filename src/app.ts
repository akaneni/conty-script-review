import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Clock } from "./clock.ts";
import { checkDueDate } from "./dates.ts";
import * as repo from "./db.ts";
import {
  canAct,
  decideApprove,
  decideNewVersion,
  decideRequestChange,
  isOverdue,
  type Action,
  type Actor,
  type Transition,
} from "./domain.ts";

class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

function parseActor(header: string | undefined): Actor | null {
  return header === "brand" || header === "creator" ? header : null;
}

function requireActor(c: Context, action: Action): void {
  if (!canAct(parseActor(c.req.header("x-actor")), action)) {
    throw new HttpError(403, "ator sem permissão para esta ação (use o header x-actor: brand ou creator)");
  }
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "corpo inválido: envie um JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "corpo inválido: envie um objeto JSON");
  }
  return body as Record<string, unknown>;
}

function requireText(body: Record<string, unknown>, field: string, label = field): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${label} é obrigatório e não pode ser vazio`);
  }
  return value;
}

function requireTransition(t: Transition): Extract<Transition, { ok: true }> {
  if (!t.ok) throw new HttpError(409, t.message);
  return t;
}

export interface AppDeps {
  db: DatabaseSync;
  clock: Clock;
}

export function createApp({ db, clock }: AppDeps): Hono {
  const app = new Hono();

  function loadScript(id: string): repo.ScriptRow {
    const script = repo.getScript(db, id);
    if (!script) throw new HttpError(404, "roteiro não encontrado");
    return script;
  }

  function view(scriptId: string) {
    const script = loadScript(scriptId);
    const versions = repo.listVersions(db, scriptId);
    const requests = repo.listChangeRequests(db, scriptId);
    const now = clock.now();
    const open = requests.find((r) => r.resolved_by_version === null) ?? null;
    const overdue = isOverdue(open?.due_date ?? null, now);
    return {
      ...script,
      overdue,
      current_version: versions.length,
      open_change_request: open ? { ...open, overdue } : null,
      versions,
      change_requests: requests,
    };
  }

  app.post("/scripts", async (c) => {
    requireActor(c, "create");
    const body = await readBody(c);
    const campaignId = requireText(body, "campaign_id");
    const creatorId = requireText(body, "creator_id");
    const content = requireText(body, "content", "content (texto do roteiro)");
    const id = randomUUID();
    const at = clock.now().toISOString();
    repo.transaction(db, () => {
      repo.insertScript(db, {
        id,
        campaign_id: campaignId,
        creator_id: creatorId,
        status: "awaiting_review",
        created_at: at,
      });
      repo.insertVersion(db, id, { number: 1, content, created_at: at });
    });
    return c.json(view(id), 201);
  });

  app.get("/scripts/:id", (c) => c.json(view(loadScript(c.req.param("id")).id)));

  app.post("/scripts/:id/change-requests", async (c) => {
    requireActor(c, "request_change");
    const script = loadScript(c.req.param("id"));
    const body = await readBody(c);
    const reason = requireText(body, "reason", "reason (motivo)");
    if (body.due_date === undefined || body.due_date === null || body.due_date === "") {
      throw new HttpError(400, "due_date (prazo) é obrigatório");
    }
    const now = clock.now();
    const due = checkDueDate(body.due_date, now);
    if (!due.ok && due.kind === "invalid") {
      throw new HttpError(400, "due_date inválido: use uma data real no formato YYYY-MM-DD");
    }
    repo.transaction(db, () => {
      const current = loadScript(script.id);
      const t = requireTransition(decideRequestChange(current.status));
      if (!due.ok) throw new HttpError(422, "prazo já passou: escolha hoje ou uma data futura (America/Sao_Paulo)");
      repo.insertChangeRequest(db, script.id, {
        id: randomUUID(),
        version_number: repo.latestVersionNumber(db, script.id),
        reason: reason.trim(),
        due_date: due.value,
        created_at: now.toISOString(),
        resolved_by_version: null,
      });
      repo.setStatus(db, script.id, t.next);
    });
    return c.json(view(script.id), 201);
  });

  app.post("/scripts/:id/versions", async (c) => {
    requireActor(c, "submit_version");
    const script = loadScript(c.req.param("id"));
    const body = await readBody(c);
    const content = requireText(body, "content", "content (texto do roteiro)");
    repo.transaction(db, () => {
      const t = requireTransition(decideNewVersion(loadScript(script.id).status));
      const number = repo.latestVersionNumber(db, script.id) + 1;
      repo.insertVersion(db, script.id, { number, content, created_at: clock.now().toISOString() });
      repo.resolveOpenRequest(db, script.id, number);
      repo.setStatus(db, script.id, t.next);
    });
    return c.json(view(script.id), 201);
  });

  app.post("/scripts/:id/approve", (c) => {
    requireActor(c, "approve");
    const script = loadScript(c.req.param("id"));
    repo.transaction(db, () => {
      const t = requireTransition(decideApprove(loadScript(script.id).status));
      repo.setStatus(db, script.id, t.next);
    });
    return c.json(view(script.id));
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "erro interno" }, 500);
  });
  app.notFound((c) => c.json({ error: "rota não encontrada" }, 404));

  return app;
}
