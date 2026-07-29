import { describe, expect, it } from "vitest";
import {
  VALIDADE_MS,
  comparaSegura,
  gerarToken,
  sha256Hex,
  verificarLogin,
  verificarToken,
} from "../src/auth.js";

const SEGREDO = "segredo-de-teste";

describe("sha256Hex", () => {
  it("gera hash hex de 64 caracteres", async () => {
    const hash = await sha256Hex("Ultra5*");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("é determinístico e sensível à entrada", async () => {
    expect(await sha256Hex("abc")).toBe(await sha256Hex("abc"));
    expect(await sha256Hex("abc")).not.toBe(await sha256Hex("abd"));
  });
});

describe("comparaSegura", () => {
  it("compara corretamente", () => {
    expect(comparaSegura("igual", "igual")).toBe(true);
    expect(comparaSegura("igual", "IGUAL")).toBe(false);
    expect(comparaSegura("curto", "bem mais longo")).toBe(false);
  });
});

describe("token", () => {
  it("aceita um token recém-gerado", async () => {
    const token = await gerarToken(SEGREDO);
    expect(await verificarToken(SEGREDO, token)).toBe(true);
  });

  it("recusa token assinado com outro segredo", async () => {
    const token = await gerarToken("outro-segredo");
    expect(await verificarToken(SEGREDO, token)).toBe(false);
  });

  it("recusa token com payload adulterado", async () => {
    const token = await gerarToken(SEGREDO);
    const [, assinatura] = token.split(".");
    const falso = `${btoa('{"exp":99999999999999}').replace(/=+$/, "")}.${assinatura}`;
    expect(await verificarToken(SEGREDO, falso)).toBe(false);
  });

  it("recusa token expirado", async () => {
    const passado = Date.now() - VALIDADE_MS - 1000;
    const token = await gerarToken(SEGREDO, passado);
    expect(await verificarToken(SEGREDO, token)).toBe(false);
  });

  it("recusa lixo", async () => {
    expect(await verificarToken(SEGREDO, "")).toBe(false);
    expect(await verificarToken(SEGREDO, "sem-ponto")).toBe(false);
    expect(await verificarToken(SEGREDO, "a.b")).toBe(false);
    expect(await verificarToken(SEGREDO, null)).toBe(false);
  });
});

describe("verificarLogin", () => {
  it("aceita usuário e senha corretos", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("senha-certa") };
    expect(await verificarLogin(env, "madruga", "senha-certa")).toBe(true);
  });

  it("recusa senha errada e usuário errado", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("senha-certa") };
    expect(await verificarLogin(env, "madruga", "senha-errada")).toBe(false);
    expect(await verificarLogin(env, "outro", "senha-certa")).toBe(false);
  });

  it("recusa entradas que não são string", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("x") };
    expect(await verificarLogin(env, null, undefined)).toBe(false);
  });
});
