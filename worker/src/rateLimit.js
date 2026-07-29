import { sha256Hex } from "./auth.js";

export const LIMITE = 5;
// Tentativas de login erradas por IP por hora. Independente do limite de
// pedidos: um visitante legítimo não deve perder a chance de pedir porque
// alguém tentou adivinhar a senha do mesmo IP, e vice-versa.
export const LIMITE_LOGIN = 10;
export const JANELA_MS = 60 * 60 * 1000;

// Prefixo para separar as duas contagens dentro da mesma tabela.
export const escopoLogin = (ipHash) => `login:${ipHash}`;

// Guarda só o hash: o IP em si é dado pessoal e não precisa ser persistido.
// Falha fechado se o secret não estiver configurado: sem sal, o hash de um IP
// vira pré-computável para todo o espaço IPv4 e a proteção deixa de existir.
// Melhor a rota devolver 500 do que gravar hashes reversíveis em silêncio.
export function hashIp(ip, salt) {
  if (typeof salt !== "string" || salt === "") {
    throw new Error("IP_SALT não configurado.");
  }
  return sha256Hex(`${ip}:${salt}`);
}

export async function dentroDoLimite(db, ipHash, agora = Date.now(), limite = LIMITE) {
  const desde = new Date(agora - JANELA_MS).toISOString();
  const linha = await db
    .prepare("SELECT COUNT(*) AS total FROM rate_limit WHERE ip_hash = ? AND criado_em >= ?")
    .bind(ipHash, desde)
    .first();
  return (linha?.total ?? 0) < limite;
}

export async function registrarEnvio(db, ipHash, agora = Date.now()) {
  await db
    .prepare("INSERT INTO rate_limit (ip_hash, criado_em) VALUES (?, ?)")
    .bind(ipHash, new Date(agora).toISOString())
    .run();
}

export async function limparAntigos(db, agora = Date.now()) {
  const desde = new Date(agora - JANELA_MS).toISOString();
  await db.prepare("DELETE FROM rate_limit WHERE criado_em < ?").bind(desde).run();
}
