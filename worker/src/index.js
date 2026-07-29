import { listarPedidos, criarPedido } from "./db.js";
import { validarPedido } from "./validacao.js";

const ORIGEM_PERMITIDA = "https://paes.github.io";

function cors(origem) {
  const cabecalhos = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (origem === ORIGEM_PERMITIDA) {
    cabecalhos["Access-Control-Allow-Origin"] = origem;
  }
  return cabecalhos;
}

export function json(dados, status, origem) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origem) },
  });
}

export function erro(mensagem, status, origem) {
  return json({ erro: mensagem }, status, origem);
}

async function postPedido(request, env, origem) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro("Corpo inválido.", 400, origem);
  }

  const validacao = validarPedido(corpo);
  if (!validacao.ok) return erro(validacao.erro, 400, origem);

  return json(await criarPedido(env.DB, validacao.pedido), 201, origem);
}

export default {
  async fetch(request, env) {
    const origem = request.headers.get("Origin");
    const rota = new URL(request.url).pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origem) });
    }

    try {
      if (rota === "/pedidos" && request.method === "GET") {
        return json(await listarPedidos(env.DB), 200, origem);
      }
      if (rota === "/pedidos" && request.method === "POST") {
        return await postPedido(request, env, origem);
      }
      return erro("Rota não encontrada.", 404, origem);
    } catch (e) {
      console.error(e);
      return erro("Erro interno.", 500, origem);
    }
  },
};
