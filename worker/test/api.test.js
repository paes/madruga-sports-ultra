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
