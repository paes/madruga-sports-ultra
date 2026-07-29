import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { aplicarSchema, limparBanco } from "./helpers.js";

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
