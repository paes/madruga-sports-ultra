import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  JANELA_MS,
  LIMITE,
  dentroDoLimite,
  hashIp,
  limparAntigos,
  registrarEnvio,
} from "../src/rateLimit.js";
import { aplicarSchema, limparBanco } from "./helpers.js";

const SALT = "salt-de-teste";
const AGORA = Date.parse("2026-07-24T12:00:00.000Z");

beforeAll(() => aplicarSchema(env.DB));
beforeEach(() => limparBanco(env.DB));

describe("hashIp", () => {
  it("falha fechado quando o sal não está configurado", async () => {
    expect(() => hashIp("203.0.113.7", undefined)).toThrow(/IP_SALT/);
    expect(() => hashIp("203.0.113.7", "")).toThrow(/IP_SALT/);
  });

  it("gera hashes diferentes para sais diferentes", async () => {
    const a = await hashIp("203.0.113.7", SALT);
    const b = await hashIp("203.0.113.7", "outro-sal");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

// A janela deslizante é a metade do requisito que os testes de rota não
// cobrem: lá só dá pra provar a contagem, não a expiração por tempo.
describe("janela de uma hora", () => {
  it("libera de novo quando os envios saem da janela", async () => {
    const ipHash = await hashIp("203.0.113.7", SALT);

    // Cinco envios logo antes da janela de agora: já expirados.
    const antigo = AGORA - JANELA_MS - 1000;
    for (let i = 0; i < LIMITE; i++) {
      await registrarEnvio(env.DB, ipHash, antigo);
    }
    expect(await dentroDoLimite(env.DB, ipHash, AGORA)).toBe(true);
  });

  it("bloqueia quando os envios estão dentro da janela", async () => {
    const ipHash = await hashIp("203.0.113.7", SALT);

    const recente = AGORA - 60 * 1000;
    for (let i = 0; i < LIMITE; i++) {
      await registrarEnvio(env.DB, ipHash, recente);
    }
    expect(await dentroDoLimite(env.DB, ipHash, AGORA)).toBe(false);
  });

  it("conta o envio exatamente na borda da janela", async () => {
    const ipHash = await hashIp("203.0.113.7", SALT);

    // LIMITE-1 envios recentes + 1 exatamente na borda = LIMITE no total.
    for (let i = 0; i < LIMITE - 1; i++) {
      await registrarEnvio(env.DB, ipHash, AGORA - 60 * 1000);
    }
    await registrarEnvio(env.DB, ipHash, AGORA - JANELA_MS);
    expect(await dentroDoLimite(env.DB, ipHash, AGORA)).toBe(false);
  });
});

describe("limparAntigos", () => {
  it("apaga só o que saiu da janela", async () => {
    const ipHash = await hashIp("203.0.113.7", SALT);
    await registrarEnvio(env.DB, ipHash, AGORA - JANELA_MS - 1000);
    await registrarEnvio(env.DB, ipHash, AGORA - 60 * 1000);

    await limparAntigos(env.DB, AGORA);

    const { results } = await env.DB.prepare("SELECT criado_em FROM rate_limit").all();
    expect(results).toHaveLength(1);
    expect(results[0].criado_em).toBe(new Date(AGORA - 60 * 1000).toISOString());
  });
});
