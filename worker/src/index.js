import { listarPedidos, criarPedido, marcarPago } from "./db.js";
import { validarPedido } from "./validacao.js";
import { VALIDADE_MS, gerarToken, verificarLogin, verificarToken } from "./auth.js";
import { dentroDoLimite, hashIp, limparAntigos, registrarEnvio } from "./rateLimit.js";

const ORIGEM_PERMITIDA = "https://madruga-sports.pages.dev";

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

  const ip = request.headers.get("CF-Connecting-IP") || "desconhecido";
  const ipHash = await hashIp(ip, env.IP_SALT);

  await limparAntigos(env.DB);
  if (!(await dentroDoLimite(env.DB, ipHash))) {
    return erro(
      "Muitos pedidos desse aparelho em pouco tempo. Tente novamente daqui a pouco.",
      429,
      origem
    );
  }

  const pedido = await criarPedido(env.DB, validacao.pedido);
  await registrarEnvio(env.DB, ipHash);
  return json(pedido, 201, origem);
}

async function postLogin(request, env, origem) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro("Corpo inválido.", 400, origem);
  }
  // `JSON.parse("null")` não lança, então o try acima não pega esse caso:
  // sem esta guarda, um corpo `null` viraria TypeError e 500 numa rota aberta.
  if (!corpo || typeof corpo !== "object") {
    return erro("Corpo inválido.", 400, origem);
  }
  if (!(await verificarLogin(env, corpo.usuario, corpo.senha))) {
    return erro("Usuário ou senha incorretos.", 401, origem);
  }
  const token = await gerarToken(env.TOKEN_SECRET);
  return json({ token, expiraEm: Date.now() + VALIDADE_MS }, 200, origem);
}

async function autenticado(request, env) {
  const cabecalho = request.headers.get("Authorization") || "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  return verificarToken(env.TOKEN_SECRET, token);
}

async function getAdminPedidos(request, env, origem) {
  if (!(await autenticado(request, env))) return erro("Não autorizado.", 401, origem);
  return json(await listarPedidos(env.DB, { incluirWhats: true }), 200, origem);
}

async function patchPedido(request, env, origem, id) {
  if (!(await autenticado(request, env))) return erro("Não autorizado.", 401, origem);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro("Corpo inválido.", 400, origem);
  }
  if (!corpo || typeof corpo !== "object") {
    return erro("Corpo inválido.", 400, origem);
  }
  if (typeof corpo.pago !== "boolean") {
    return erro("Campo 'pago' deve ser true ou false.", 400, origem);
  }

  const pedido = await marcarPago(env.DB, id, corpo.pago);
  if (!pedido) return erro("Pedido não encontrado.", 404, origem);
  return json(pedido, 200, origem);
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
      if (rota === "/admin/login" && request.method === "POST") {
        return await postLogin(request, env, origem);
      }
      if (rota === "/admin/pedidos" && request.method === "GET") {
        return await getAdminPedidos(request, env, origem);
      }
      const admin = rota.match(/^\/admin\/pedidos\/(\d+)$/);
      if (admin && request.method === "PATCH") {
        return await patchPedido(request, env, origem, Number(admin[1]));
      }
      return erro("Rota não encontrada.", 404, origem);
    } catch (e) {
      console.error(e);
      return erro("Erro interno.", 500, origem);
    }
  },
};
