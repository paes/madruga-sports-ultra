import schema from "../schema.sql?raw";

export async function aplicarSchema(db) {
  const comandos = schema
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const comando of comandos) {
    await db.prepare(comando).run();
  }
}

export async function limparBanco(db) {
  await db.prepare("DELETE FROM pedidos").run();
  await db.prepare("DELETE FROM rate_limit").run();
}
