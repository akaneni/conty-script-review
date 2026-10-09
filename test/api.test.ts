import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Clock } from "../src/clock.ts";
import { openDatabase } from "../src/db.ts";

// 12/03/2026 às 10h em SP (UTC-3)
const MORNING = "2026-03-12T13:00:00.000Z";
const LAST_INSTANT = "2026-03-13T02:59:59.999Z"; // 23:59:59.999 de 12/03 em SP
const NEXT_DAY_FIRST = "2026-03-13T03:00:00.000Z"; // 00:00:00.000 de 13/03 em SP

let now: Date;
const clock: Clock = { now: () => now };
let app: ReturnType<typeof createApp>;

async function call(method: string, path: string, actor?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(actor ? { "x-actor": actor } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function newScript(content = "roteiro v1") {
  const r = await call("POST", "/scripts", "creator", { campaign_id: "camp-1", creator_id: "cr-1", content });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

const askChange = (id: string, body: unknown = { reason: "cortar o discurso de preço", due_date: "2026-03-12" }) =>
  call("POST", `/scripts/${id}/change-requests`, "brand", body);

beforeEach(() => {
  now = new Date(MORNING);
  app = createApp({ db: openDatabase(":memory:"), clock });
});

describe("fluxo completo", () => {
  it("cria, pede alteração, envia v2 e aprova, com v1 e v2 listadas", async () => {
    const id = await newScript("v1: abertura longa");
    let s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.status).toBe("awaiting_review");
    expect(s.versions).toHaveLength(1);

    const asked = await askChange(id);
    expect(asked.status).toBe(201);
    expect(asked.json.status).toBe("changes_requested");
    expect(asked.json.open_change_request).toMatchObject({
      version_number: 1,
      reason: "cortar o discurso de preço",
      due_date: "2026-03-12",
      resolved_by_version: null,
    });

    const v2 = await call("POST", `/scripts/${id}/versions`, "creator", { content: "v2: abertura curta" });
    expect(v2.status).toBe(201);
    expect(v2.json.status).toBe("awaiting_review");
    expect(v2.json.open_change_request).toBeNull();
    expect(v2.json.change_requests[0].resolved_by_version).toBe(2);

    const approved = await call("POST", `/scripts/${id}/approve`, "brand");
    expect(approved.status).toBe(200);
    s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.status).toBe("approved");
    expect(s.versions.map((v: any) => [v.number, v.content])).toEqual([
      [1, "v1: abertura longa"],
      [2, "v2: abertura curta"],
    ]);
  });

  it("aprova direto quando não há pedido", async () => {
    const id = await newScript();
    expect((await call("POST", `/scripts/${id}/approve`, "brand")).json.status).toBe("approved");
  });

  it("guarda o histórico de vários ciclos sem sobrescrever versões", async () => {
    const id = await newScript("a");
    await askChange(id);
    await call("POST", `/scripts/${id}/versions`, "creator", { content: "b" });
    await askChange(id, { reason: "mais um ajuste", due_date: "2026-03-15" });
    const r = await call("POST", `/scripts/${id}/versions`, "creator", { content: "c" });
    expect(r.json.versions.map((v: any) => v.content)).toEqual(["a", "b", "c"]);
    expect(r.json.change_requests.map((q: any) => [q.version_number, q.resolved_by_version])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });
});

describe("validação do pedido (400)", () => {
  it.each([
    ["sem motivo", { due_date: "2026-03-12" }],
    ["motivo só com espaços", { reason: "   ", due_date: "2026-03-12" }],
    ["sem prazo", { reason: "ajustar" }],
    ["prazo malformado", { reason: "ajustar", due_date: "12/03/2026" }],
    ["prazo com data e hora", { reason: "ajustar", due_date: "2026-03-12T10:00:00Z" }],
    ["prazo inexistente", { reason: "ajustar", due_date: "2026-02-30" }],
    ["prazo não texto", { reason: "ajustar", due_date: 20260312 }],
  ])("recusa %s", async (_nome, body) => {
    const id = await newScript();
    const r = await askChange(id, body);
    expect(r.status).toBe(400);
    expect(r.json.error).toEqual(expect.any(String));
    expect((await call("GET", `/scripts/${id}`)).json.status).toBe("awaiting_review");
  });

  it("recusa corpo que não é JSON", async () => {
    const id = await newScript();
    expect((await askChange(id, "isso não é json{")).status).toBe(400);
  });

  it("recusa roteiro sem conteúdo e versão sem conteúdo", async () => {
    expect((await call("POST", "/scripts", "creator", { campaign_id: "c", creator_id: "x", content: " " })).status).toBe(400);
    const id = await newScript();
    await askChange(id);
    expect((await call("POST", `/scripts/${id}/versions`, "creator", {})).status).toBe(400);
  });
});

describe("prazo em America/Sao_Paulo com relógio controlado", () => {
  it("aceita o prazo de hoje no último instante do dia (23:59:59.999 em SP, UTC já no dia 13)", async () => {
    const id = await newScript();
    now = new Date(LAST_INSTANT);
    const r = await askChange(id, { reason: "ajustar", due_date: "2026-03-12" });
    expect(r.status).toBe(201);
    expect(r.json.open_change_request.due_date).toBe("2026-03-12");
  });

  it("recusa com 422 o mesmo prazo no primeiro instante do dia seguinte", async () => {
    const id = await newScript();
    now = new Date(NEXT_DAY_FIRST);
    const r = await askChange(id, { reason: "ajustar", due_date: "2026-03-12" });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/prazo já passou/);
    expect((await call("GET", `/scripts/${id}`)).json.status).toBe("awaiting_review");
  });

  it("no primeiro instante do dia seguinte, o prazo do dia novo vale", async () => {
    const id = await newScript();
    now = new Date(NEXT_DAY_FIRST);
    expect((await askChange(id, { reason: "ajustar", due_date: "2026-03-13" })).status).toBe(201);
  });

  it("às 21h em SP (UTC já virou o dia), o prazo de hoje em SP continua válido", async () => {
    const id = await newScript();
    now = new Date("2026-03-13T00:30:00.000Z"); // 21:30 de 12/03 em SP
    expect((await askChange(id, { reason: "ajustar", due_date: "2026-03-12" })).status).toBe(201);
  });

  it("recusa prazo de ontem", async () => {
    const id = await newScript();
    expect((await askChange(id, { reason: "ajustar", due_date: "2026-03-11" })).status).toBe(422);
  });

  it("overdue só vira true depois do fim do dia, sem mudar o estado", async () => {
    const id = await newScript();
    await askChange(id);
    now = new Date(LAST_INSTANT);
    let s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.overdue).toBe(false);
    now = new Date(NEXT_DAY_FIRST);
    s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.overdue).toBe(true);
    expect(s.open_change_request.overdue).toBe(true);
    expect(s.status).toBe("changes_requested");
  });

  it("depois de vencido, o criador ainda pode enviar a versão", async () => {
    const id = await newScript();
    await askChange(id);
    now = new Date("2026-03-20T12:00:00.000Z");
    const r = await call("POST", `/scripts/${id}/versions`, "creator", { content: "v2 atrasada" });
    expect(r.status).toBe(201);
    expect(r.json.overdue).toBe(false);
  });
});

describe("estados que bloqueiam (409)", () => {
  it("aprovado não aceita nova versão nem novo pedido nem nova aprovação", async () => {
    const id = await newScript();
    await call("POST", `/scripts/${id}/approve`, "brand");
    const v = await call("POST", `/scripts/${id}/versions`, "creator", { content: "tarde demais" });
    expect(v.status).toBe(409);
    expect(v.json.error).toMatch(/aprova/);
    expect((await askChange(id)).status).toBe(409);
    expect((await call("POST", `/scripts/${id}/approve`, "brand")).status).toBe(409);
    const s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.versions).toHaveLength(1);
    expect(s.change_requests).toHaveLength(0);
  });

  it("aprovado continua bloqueado mesmo com prazo passado no pedido", async () => {
    const id = await newScript();
    await call("POST", `/scripts/${id}/approve`, "brand");
    now = new Date(NEXT_DAY_FIRST);
    expect((await askChange(id)).status).toBe(409);
  });

  it("versão sem pedido aberto dá 409", async () => {
    const id = await newScript();
    expect((await call("POST", `/scripts/${id}/versions`, "creator", { content: "v2" })).status).toBe(409);
  });

  it("pedido duplicado dá 409 e mantém o primeiro", async () => {
    const id = await newScript();
    await askChange(id);
    const second = await askChange(id, { reason: "outro", due_date: "2026-03-20" });
    expect(second.status).toBe(409);
    const s = (await call("GET", `/scripts/${id}`)).json;
    expect(s.change_requests).toHaveLength(1);
    expect(s.open_change_request.reason).toBe("cortar o discurso de preço");
  });

  it("aprovar com pedido aberto dá 409", async () => {
    const id = await newScript();
    await askChange(id);
    expect((await call("POST", `/scripts/${id}/approve`, "brand")).status).toBe(409);
  });

  it("409 vem antes do 422: pedido duplicado com prazo passado ainda é conflito de estado", async () => {
    const id = await newScript();
    await askChange(id);
    expect((await askChange(id, { reason: "x", due_date: "2026-03-01" })).status).toBe(409);
  });
});

describe("permissões (403)", () => {
  it("criador não pede alteração nem aprova", async () => {
    const id = await newScript();
    const body = { reason: "x", due_date: "2026-03-12" };
    expect((await call("POST", `/scripts/${id}/change-requests`, "creator", body)).status).toBe(403);
    expect((await call("POST", `/scripts/${id}/approve`, "creator")).status).toBe(403);
    expect((await call("GET", `/scripts/${id}`)).json.status).toBe("awaiting_review");
  });

  it("marca não cria roteiro nem envia versão", async () => {
    expect((await call("POST", "/scripts", "brand", { campaign_id: "c", creator_id: "x", content: "r" })).status).toBe(403);
    const id = await newScript();
    await askChange(id);
    expect((await call("POST", `/scripts/${id}/versions`, "brand", { content: "v2" })).status).toBe(403);
  });

  it("sem header ou com ator desconhecido dá 403", async () => {
    const id = await newScript();
    expect((await call("POST", `/scripts/${id}/approve`)).status).toBe(403);
    expect((await call("POST", `/scripts/${id}/approve`, "admin")).status).toBe(403);
  });
});

describe("404", () => {
  it("roteiro inexistente em leitura e em escrita", async () => {
    expect((await call("GET", "/scripts/nao-existe")).status).toBe(404);
    expect((await call("POST", "/scripts/nao-existe/approve", "brand")).status).toBe(404);
    expect((await call("POST", "/scripts/nao-existe/change-requests", "brand", { reason: "x", due_date: "2026-03-12" })).status).toBe(404);
    expect((await call("POST", "/scripts/nao-existe/versions", "creator", { content: "x" })).status).toBe(404);
  });
});
