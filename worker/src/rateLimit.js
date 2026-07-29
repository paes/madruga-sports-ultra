import { sha256Hex } from "./auth.js";

export const LIMITE = 5;
export const JANELA_MS = 60 * 60 * 1000;

// Guarda só o hash: o IP em si é dado pessoal e não precisa ser persistido.
export function hashIp(ip, salt) {
  return sha256Hex(`${ip}:${salt}`);
}

export async function dentroDoLimite(db, ipHash, agora = Date.now()) {
  const desde = new Date(agora - JANELA_MS).toISOString();
  const linha = await db
    .prepare("SELECT COUNT(*) AS total FROM rate_limit WHERE ip_hash = ? AND criado_em >= ?")
    .bind(ipHash, desde)
    .first();
  return (linha?.total ?? 0) < LIMITE;
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
