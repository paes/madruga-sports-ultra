const CAMPOS_PUBLICOS = "id, nome, modelo, tamanho, nome_costas, pago, criado_em";
const CAMPOS_ADMIN = "id, nome, modelo, tamanho, nome_costas, whats, pago, criado_em";

// Traduz a linha do banco para o formato que o JavaScript da página já espera.
// O campo `whats` só entra no resultado se veio na linha — é o que impede o
// vazamento na listagem pública.
export function paraJson(linha) {
  const pedido = {
    id: linha.id,
    nome: linha.nome,
    modelo: linha.modelo,
    tamanho: linha.tamanho,
    nomeCostas: linha.nome_costas,
    pago: linha.pago === 1,
    ts: linha.criado_em,
  };
  if ("whats" in linha) pedido.whats = linha.whats;
  return pedido;
}

export async function listarPedidos(db, { incluirWhats = false } = {}) {
  const campos = incluirWhats ? CAMPOS_ADMIN : CAMPOS_PUBLICOS;
  const { results } = await db
    .prepare(`SELECT ${campos} FROM pedidos ORDER BY criado_em DESC, id DESC`)
    .all();
  return results.map(paraJson);
}
