CREATE TABLE IF NOT EXISTS pedidos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT    NOT NULL,
  modelo      TEXT    NOT NULL,
  tamanho     TEXT    NOT NULL,
  nome_costas TEXT    NOT NULL,
  whats       TEXT,
  pago        INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_criado_em ON pedidos (criado_em DESC);

CREATE TABLE IF NOT EXISTS rate_limit (
  ip_hash   TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit ON rate_limit (ip_hash, criado_em);
