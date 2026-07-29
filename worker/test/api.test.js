import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { aplicarSchema, limparBanco } from "./helpers.js";
import { sha256Hex } from "../src/auth.js";

const ORIGEM = "https://paes.github.io";

async function chamar(caminho, opcoes = {}) {
  const request = new Request(`https://exemplo.com${caminho}`, {
    ...opcoes,
    headers: { Origin: ORIGEM, ...(opcoes.headers || {}) },
  });
  const ctx = createExecutionContext();
  const resposta = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}

beforeAll(() => aplicarSchema(env.DB));
beforeEach(() => limparBanco(env.DB));

describe("GET /pedidos", () => {
  it("devolve lista vazia quando não há pedidos", async () => {
    const resposta = await chamar("/pedidos");
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });

  it("libera CORS para a origem do GitHub Pages", async () => {
    const resposta = await chamar("/pedidos");
    expect(resposta.headers.get("Access-Control-Allow-Origin")).toBe(ORIGEM);
  });

  it("não libera CORS para outra origem", async () => {
    const resposta = await chamar("/pedidos", { headers: { Origin: "https://site-falso.com" } });
    expect(resposta.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

const PEDIDO = {
  nome: "Alex Madruga",
  modelo: "Regata",
  tamanho: "G",
  nomeCostas: "MADRUGA",
  whats: "48991311234",
};

function postPedido(corpo) {
  return chamar("/pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

describe("POST /pedidos", () => {
  it("cria o pedido e devolve 201", async () => {
    const resposta = await postPedido(PEDIDO);
    expect(resposta.status).toBe(201);
    const criado = await resposta.json();
    expect(criado.id).toBeGreaterThan(0);
    expect(criado.nome).toBe("Alex Madruga");
    expect(criado.pago).toBe(false);
  });

  it("NUNCA devolve whats na resposta da criação", async () => {
    const resposta = await postPedido(PEDIDO);
    const bruto = await resposta.text();
    // JSON cru, não a propriedade desserializada: pega vazamento mesmo que o
    // campo saia com outro nome.
    expect(bruto).toContain("MADRUGA");
    expect(bruto).not.toContain("whats");
    expect(bruto).not.toContain("48991311234");
  });

  it("NUNCA expõe whats no GET público, mesmo com telefone preenchido", async () => {
    await postPedido(PEDIDO);
    const resposta = await chamar("/pedidos");
    const bruto = await resposta.text();
    // A asserção positiva garante que a lista não está vazia: sem ela, uma
    // quebra na criação faria as duas checagens abaixo passarem provando nada.
    expect(bruto).toContain("MADRUGA");
    expect(bruto).not.toContain("whats");
    expect(bruto).not.toContain("48991311234");
  });

  it("carimba criado_em no servidor, ignorando o ts do cliente", async () => {
    const criado = await (await postPedido({ ...PEDIDO, ts: "1999-01-01T00:00:00.000Z" })).json();
    expect(criado.ts.startsWith("1999")).toBe(false);
    expect(new Date(criado.ts).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("ignora pago vindo do cliente", async () => {
    const criado = await (await postPedido({ ...PEDIDO, pago: true })).json();
    expect(criado.pago).toBe(false);
  });

  it("rejeita pedido inválido com 400", async () => {
    const resposta = await postPedido({ ...PEDIDO, modelo: "Boné" });
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toMatch(/modelo/i);
  });

  it("rejeita corpo que não é JSON com 400", async () => {
    const resposta = await chamar("/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "isso não é json",
    });
    expect(resposta.status).toBe(400);
  });

  it("lista os pedidos criados, mais novo primeiro", async () => {
    await postPedido({ ...PEDIDO, nome: "Primeiro" });
    await postPedido({ ...PEDIDO, nome: "Segundo" });
    const lista = await (await chamar("/pedidos")).json();
    expect(lista).toHaveLength(2);
    expect(lista[0].nome).toBe("Segundo");
  });
});

const SENHA_TESTE = "senha-de-teste-123";

// O env dos testes não tem os secrets de produção; definimos aqui.
beforeAll(async () => {
  env.ADMIN_USER = "madruga";
  env.ADMIN_PASS_HASH = await sha256Hex(SENHA_TESTE);
  env.TOKEN_SECRET = "segredo-hmac-de-teste";
  env.IP_SALT = "salt-de-teste";
});

async function logar() {
  const resposta = await chamar("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "madruga", senha: SENHA_TESTE }),
  });
  return (await resposta.json()).token;
}

describe("POST /admin/login", () => {
  it("devolve token com credenciais corretas", async () => {
    const resposta = await chamar("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "madruga", senha: SENHA_TESTE }),
    });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(typeof corpo.token).toBe("string");
    expect(corpo.expiraEm).toBeGreaterThan(Date.now());
  });

  it("devolve 400 para corpo JSON literalmente null, sem virar 500", async () => {
    const resposta = await chamar("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(resposta.status).toBe(400);
  });

  it("devolve 401 com senha errada, sem dizer qual campo errou", async () => {
    const resposta = await chamar("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "madruga", senha: "errada" }),
    });
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).erro).toBe("Usuário ou senha incorretos.");
  });
});

describe("GET /admin/pedidos", () => {
  it("devolve 401 sem token", async () => {
    expect((await chamar("/admin/pedidos")).status).toBe(401);
  });

  it("devolve 401 com token forjado", async () => {
    const resposta = await chamar("/admin/pedidos", {
      headers: { Authorization: "Bearer aaaa.bbbb" },
    });
    expect(resposta.status).toBe(401);
  });

  it("devolve whats para o admin autenticado", async () => {
    await postPedido(PEDIDO);
    const token = await logar();
    const resposta = await chamar("/admin/pedidos", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resposta.status).toBe(200);
    const lista = await resposta.json();
    expect(lista[0].whats).toBe("48991311234");
  });
});

describe("PATCH /admin/pedidos/:id", () => {
  it("devolve 401 sem token", async () => {
    const resposta = await chamar("/admin/pedidos/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(401);
  });

  it("devolve 401 com token forjado", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    const resposta = await chamar(`/admin/pedidos/${criado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer aaaa.bbbb" },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(401);
  });

  it("marca como pago e o efeito aparece no GET seguinte", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    const token = await logar();
    const resposta = await chamar(`/admin/pedidos/${criado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).pago).toBe(true);

    const lista = await (await chamar("/pedidos")).json();
    expect(lista[0].pago).toBe(true);
  });

  it("devolve 404 para id inexistente", async () => {
    const token = await logar();
    const resposta = await chamar("/admin/pedidos/99999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(404);
  });

  it("devolve 400 quando pago não é booleano", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    const token = await logar();
    const resposta = await chamar(`/admin/pedidos/${criado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: "sim" }),
    });
    expect(resposta.status).toBe(400);
  });
});
