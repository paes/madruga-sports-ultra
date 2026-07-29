import { describe, expect, it } from "vitest";
import { validarPedido } from "../src/validacao.js";

const valido = {
  nome: "Alex Madruga",
  modelo: "Regata",
  tamanho: "G",
  nomeCostas: "MADRUGA",
  whats: "48991311234",
};

describe("validarPedido", () => {
  it("aceita um pedido válido e devolve os campos com trim", () => {
    const r = validarPedido({ ...valido, nome: "  Alex Madruga  " });
    expect(r.ok).toBe(true);
    expect(r.pedido.nome).toBe("Alex Madruga");
  });

  it("aceita pedido sem whats", () => {
    const { whats, ...semWhats } = valido;
    expect(validarPedido(semWhats).ok).toBe(true);
  });

  it.each(["nome", "modelo", "tamanho", "nomeCostas"])("rejeita %s vazio", (campo) => {
    const r = validarPedido({ ...valido, [campo]: "   " });
    expect(r.ok).toBe(false);
  });

  it("rejeita nome com mais de 80 caracteres", () => {
    const r = validarPedido({ ...valido, nome: "a".repeat(81) });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/longo/i);
  });

  it("rejeita nome nas costas com mais de 30 caracteres", () => {
    expect(validarPedido({ ...valido, nomeCostas: "a".repeat(31) }).ok).toBe(false);
  });

  it("rejeita modelo fora da grade", () => {
    const r = validarPedido({ ...valido, modelo: "Boné" });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/modelo/i);
  });

  it("rejeita tamanho que não existe para aquele modelo", () => {
    // Regata não tem XG, mas as camisetas têm.
    const r = validarPedido({ ...valido, modelo: "Regata", tamanho: "XG" });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/tamanho/i);
  });

  it("aceita XG para camiseta", () => {
    expect(validarPedido({ ...valido, modelo: "Camiseta Fundo Preto", tamanho: "XG" }).ok).toBe(true);
  });

  it("aceita tamanho numérico da infantil", () => {
    expect(validarPedido({ ...valido, modelo: "Camiseta Infantil (Citrino)", tamanho: "10" }).ok).toBe(true);
  });

  it("rejeita corpo que não é objeto", () => {
    expect(validarPedido(null).ok).toBe(false);
    expect(validarPedido("texto").ok).toBe(false);
  });

  it("ignora pago e ts mandados pelo cliente", () => {
    const r = validarPedido({ ...valido, pago: true, ts: "1999-01-01T00:00:00Z" });
    expect(r.pedido.pago).toBeUndefined();
    expect(r.pedido.ts).toBeUndefined();
  });
});
