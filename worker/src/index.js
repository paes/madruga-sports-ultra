import { listarPedidos } from "./db.js";

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
      return erro("Rota não encontrada.", 404, origem);
    } catch (e) {
      console.error(e);
      return erro("Erro interno.", 500, origem);
    }
  },
};
