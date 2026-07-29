const codificador = new TextEncoder();

export const VALIDADE_MS = 12 * 60 * 60 * 1000;

export async function sha256Hex(texto) {
  const buffer = await crypto.subtle.digest("SHA-256", codificador.encode(texto));
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparação em tempo constante para o conteúdo. O retorno antecipado por
// tamanho diferente é aceitável aqui: os hashes comparados têm sempre 64
// caracteres, então o tamanho não carrega informação sobre a senha.
export function comparaSegura(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

function paraBase64Url(bytes) {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto) {
  const normalizado = texto.replace(/-/g, "+").replace(/_/g, "/");
  const preenchido = normalizado + "=".repeat((4 - (normalizado.length % 4)) % 4);
  return Uint8Array.from(atob(preenchido), (c) => c.charCodeAt(0));
}

function chaveHmac(segredo) {
  return crypto.subtle.importKey(
    "raw",
    codificador.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function gerarToken(segredo, agora = Date.now()) {
  const payload = paraBase64Url(
    codificador.encode(JSON.stringify({ exp: agora + VALIDADE_MS }))
  );
  const assinatura = await crypto.subtle.sign(
    "HMAC",
    await chaveHmac(segredo),
    codificador.encode(payload)
  );
  return `${payload}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

export async function verificarToken(segredo, token, agora = Date.now()) {
  if (typeof token !== "string") return false;
  const partes = token.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return false;

  const [payload, assinatura] = partes;
  try {
    const valida = await crypto.subtle.verify(
      "HMAC",
      await chaveHmac(segredo),
      deBase64Url(assinatura),
      codificador.encode(payload)
    );
    if (!valida) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(deBase64Url(payload)));
    return typeof exp === "number" && agora < exp;
  } catch {
    return false;
  }
}

export async function verificarLogin(env, usuario, senha) {
  if (typeof usuario !== "string" || typeof senha !== "string") return false;
  const hashInformado = await sha256Hex(senha);
  const usuarioOk = comparaSegura(usuario, env.ADMIN_USER);
  const senhaOk = comparaSegura(hashInformado, env.ADMIN_PASS_HASH);
  return usuarioOk && senhaOk;
}
