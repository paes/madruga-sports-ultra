# Armazenamento real de pedidos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `window.storage` (que só funciona dentro da Claude) por uma API real em Cloudflare Workers + D1, mantendo a página no GitHub Pages e garantindo que o WhatsApp do cliente nunca apareça na listagem pública.

**Architecture:** Um Worker é a única peça que fala com o banco D1 e decide, por requisição, se devolve o campo `whats`. O navegador nunca tem credencial de banco — só chama a API. A página continua servida pelo GitHub Pages e passa a fazer `fetch` para o Worker.

**Tech Stack:** Cloudflare Workers (JavaScript, ES modules), Cloudflare D1 (SQLite), Wrangler CLI, Vitest com `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-07-24-armazenamento-pedidos-design.md`

## Global Constraints

- Origem CORS permitida: exatamente `https://paes.github.io`. Nenhuma outra.
- `GET /pedidos` (anônimo) **nunca** pode conter o campo `whats`. É o requisito central.
- `criado_em` e `pago` são definidos pelo servidor no INSERT; o que o cliente mandar nesses campos é ignorado.
- Nenhum secret (usuário, senha, hash, salt) pode aparecer em arquivo versionado. Todos entram via `wrangler secret put`.
- Nomes de código, mensagens e comentários em português, seguindo o estilo do `index.html` existente.
- O `index.html` não muda de estrutura, CSS ou layout — só o bloco `<script>`.
- Node.js 18+ (o ambiente tem v18.20.8 via nvm).

## Estrutura de arquivos

Tudo novo fica em `worker/`. O `index.html` é o único arquivo existente modificado.

| Arquivo | Responsabilidade |
|---|---|
| `worker/wrangler.toml` | Configuração do Worker e binding do D1 |
| `worker/package.json` | Dependências de desenvolvimento e script de teste |
| `worker/vitest.config.js` | Configuração do Vitest com runtime de Workers |
| `worker/schema.sql` | DDL das tabelas `pedidos` e `rate_limit` |
| `worker/src/index.js` | Roteador HTTP, CORS e handlers |
| `worker/src/db.js` | Consultas ao D1 e tradução linha↔JSON |
| `worker/src/validacao.js` | Grade de modelos/tamanhos e validação do pedido |
| `worker/src/auth.js` | Hash, comparação segura e token HMAC |
| `worker/src/rateLimit.js` | Hash de IP e janela de limite |
| `worker/test/helpers.js` | Aplicação do schema nos testes |
| `worker/test/validacao.test.js` | Unitários da validação |
| `worker/test/auth.test.js` | Unitários do token |
| `worker/test/api.test.js` | Integração dos endpoints |
| `index.html` | Troca `window.storage` por `fetch` |

---

### Task 1: Scaffold do Worker, schema e `GET /pedidos`

Entrega: `GET /pedidos` respondendo `[]` a partir de um D1 real, com CORS correto. Prova que toolchain, binding e testes funcionam.

**Files:**
- Create: `worker/package.json`, `worker/wrangler.toml`, `worker/vitest.config.js`, `worker/schema.sql`, `worker/src/index.js`, `worker/src/db.js`, `worker/test/helpers.js`
- Create: `worker/.gitignore`
- Test: `worker/test/api.test.js`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces:
  - `db.js`: `listarPedidos(db, { incluirWhats = false }) -> Promise<Pedido[]>`
  - `Pedido` = `{ id: number, nome: string, modelo: string, tamanho: string, nomeCostas: string, pago: boolean, ts: string, whats?: string }`
  - `index.js`: `export default { fetch(request, env) }`
  - `test/helpers.js`: `aplicarSchema(db) -> Promise<void>`

- [ ] **Step 1: Criar `worker/package.json`**

```json
{
  "name": "madruga-pedidos",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 2: Criar `worker/.gitignore`**

```
node_modules/
.wrangler/
```

- [ ] **Step 3: Criar `worker/wrangler.toml`**

O `database_id` é substituído pelo valor real na Task 7, quando o banco for criado. Para os testes locais o valor não é consultado.

```toml
name = "madruga-pedidos"
main = "src/index.js"
compatibility_date = "2026-07-01"

[[d1_databases]]
binding = "DB"
database_name = "madruga_pedidos"
database_id = "substituir-na-task-7"
```

- [ ] **Step 4: Criar `worker/schema.sql`**

```sql
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
```

- [ ] **Step 5: Criar `worker/vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { d1Databases: ["DB"] },
      },
    },
  },
});
```

- [ ] **Step 6: Criar `worker/test/helpers.js`**

O `?raw` é resolvido pelo Vite, que roda por baixo do Vitest. O schema é dividido em statements porque o `exec` do D1 não é confiável com múltiplos comandos.

```js
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
```

- [ ] **Step 7: Escrever o teste que falha**

Criar `worker/test/api.test.js`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { aplicarSchema, limparBanco } from "./helpers.js";

const ORIGEM = "https://paes.github.io";

async function chamar(caminho, opcoes = {}) {
  const request = new Request(`https://exemplo.com${caminho}`, {
    ...opcoes,
    headers: { Origin: ORIGEM, ...(opcoes.headers || {}) },
  });
  const ctx = createExecutionContext();
  const resposta = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}

beforeAll(() => aplicarSchema(env.DB));
beforeEach(() => limparBanco(env.DB));

describe("GET /pedidos", () => {
  it("devolve lista vazia quando não há pedidos", async () => {
    const resposta = await chamar("/pedidos");
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });

  it("libera CORS para a origem do GitHub Pages", async () => {
    const resposta = await chamar("/pedidos");
    expect(resposta.headers.get("Access-Control-Allow-Origin")).toBe(ORIGEM);
  });

  it("não libera CORS para outra origem", async () => {
    const resposta = await chamar("/pedidos", { headers: { Origin: "https://site-falso.com" } });
    expect(resposta.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
```

- [ ] **Step 8: Rodar o teste e confirmar que falha**

```bash
cd worker && npm install && npm test
```

Esperado: FAIL — `src/index.js` não existe (erro de resolução de módulo).

- [ ] **Step 9: Criar `worker/src/db.js`**

```js
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
```

- [ ] **Step 10: Criar `worker/src/index.js`**

```js
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
```

- [ ] **Step 11: Rodar os testes e confirmar que passam**

```bash
cd worker && npm test
```

Esperado: PASS, 3 testes.

- [ ] **Step 12: Commit**

```bash
git add worker/ && git commit -m "feat(worker): scaffold, schema D1 e GET /pedidos"
```

---

### Task 2: Validação do pedido

Entrega: módulo puro que valida o corpo do pedido contra a grade de modelos/tamanhos da página.

**Files:**
- Create: `worker/src/validacao.js`
- Test: `worker/test/validacao.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `validarPedido(corpo) -> { ok: true, pedido: {nome, modelo, tamanho, nomeCostas, whats} } | { ok: false, erro: string }`
  - `GRADE` — objeto `{ [modelo: string]: string[] }`

- [ ] **Step 1: Escrever os testes que falham**

Criar `worker/test/validacao.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker && npm test -- validacao
```

Esperado: FAIL — `src/validacao.js` não existe.

- [ ] **Step 3: Criar `worker/src/validacao.js`**

```js
// Espelha a constante SIZES do index.html. Se a grade da página mudar,
// esta tabela precisa mudar junto.
export const GRADE = {
  "Camiseta Fundo Preto": ["PP", "P", "M", "G", "GG", "XG"],
  "Camiseta Fundo Laranja": ["PP", "P", "M", "G", "GG", "XG"],
  "Regata": ["PP", "P", "M", "G", "GG"],
  "Camiseta Infantil (Citrino)": ["2", "4", "6", "8", "10", "12", "14"],
};

const LIMITES = { nome: 80, nomeCostas: 30, whats: 20 };

const texto = (v) => (typeof v === "string" ? v.trim() : "");

export function validarPedido(corpo) {
  if (!corpo || typeof corpo !== "object") {
    return { ok: false, erro: "Corpo inválido." };
  }

  const nome = texto(corpo.nome);
  const modelo = texto(corpo.modelo);
  const tamanho = texto(corpo.tamanho);
  const nomeCostas = texto(corpo.nomeCostas);
  const whats = texto(corpo.whats);

  if (!nome || !modelo || !tamanho || !nomeCostas) {
    return { ok: false, erro: "Preencha todos os campos obrigatórios." };
  }
  if (nome.length > LIMITES.nome) {
    return { ok: false, erro: "Nome muito longo." };
  }
  if (nomeCostas.length > LIMITES.nomeCostas) {
    return { ok: false, erro: "Nome nas costas muito longo." };
  }
  if (whats.length > LIMITES.whats) {
    return { ok: false, erro: "WhatsApp inválido." };
  }

  const tamanhos = GRADE[modelo];
  if (!tamanhos) {
    return { ok: false, erro: "Modelo inválido." };
  }
  if (!tamanhos.includes(tamanho)) {
    return { ok: false, erro: "Tamanho inválido para esse modelo." };
  }

  // Devolve só os campos permitidos: pago e criado_em são do servidor.
  return { ok: true, pedido: { nome, modelo, tamanho, nomeCostas, whats } };
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

```bash
cd worker && npm test -- validacao
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/validacao.js worker/test/validacao.test.js
git commit -m "feat(worker): validacao do pedido contra a grade de modelos"
```

---

### Task 3: `POST /pedidos` e a garantia de não vazar o WhatsApp

Entrega: criação de pedido persistindo no D1, com o teste central de privacidade.

**Files:**
- Modify: `worker/src/db.js`, `worker/src/index.js`
- Test: `worker/test/api.test.js`

**Interfaces:**
- Consumes: `validarPedido` (Task 2), `listarPedidos`/`paraJson` (Task 1)
- Produces: `criarPedido(db, { nome, modelo, tamanho, nomeCostas, whats }) -> Promise<Pedido>` (sem `whats` no retorno)

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `worker/test/api.test.js`:

```js
const PEDIDO = {
  nome: "Alex Madruga",
  modelo: "Regata",
  tamanho: "G",
  nomeCostas: "MADRUGA",
  whats: "48991311234",
};

function postPedido(corpo) {
  return chamar("/pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

describe("POST /pedidos", () => {
  it("cria o pedido e devolve 201", async () => {
    const resposta = await postPedido(PEDIDO);
    expect(resposta.status).toBe(201);
    const criado = await resposta.json();
    expect(criado.id).toBeGreaterThan(0);
    expect(criado.nome).toBe("Alex Madruga");
    expect(criado.pago).toBe(false);
  });

  it("NUNCA devolve whats na resposta da criação", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    expect(criado.whats).toBeUndefined();
  });

  it("NUNCA expõe whats no GET público, mesmo com telefone preenchido", async () => {
    await postPedido(PEDIDO);
    const resposta = await chamar("/pedidos");
    const bruto = await resposta.text();
    // Checa o JSON cru: nem o nome do campo, nem o número em si.
    expect(bruto).not.toContain("whats");
    expect(bruto).not.toContain("48991311234");
  });

  it("carimba criado_em no servidor, ignorando o ts do cliente", async () => {
    const criado = await (await postPedido({ ...PEDIDO, ts: "1999-01-01T00:00:00.000Z" })).json();
    expect(criado.ts.startsWith("1999")).toBe(false);
    expect(new Date(criado.ts).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("ignora pago vindo do cliente", async () => {
    const criado = await (await postPedido({ ...PEDIDO, pago: true })).json();
    expect(criado.pago).toBe(false);
  });

  it("rejeita pedido inválido com 400", async () => {
    const resposta = await postPedido({ ...PEDIDO, modelo: "Boné" });
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toMatch(/modelo/i);
  });

  it("rejeita corpo que não é JSON com 400", async () => {
    const resposta = await chamar("/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "isso não é json",
    });
    expect(resposta.status).toBe(400);
  });

  it("lista os pedidos criados, mais novo primeiro", async () => {
    await postPedido({ ...PEDIDO, nome: "Primeiro" });
    await postPedido({ ...PEDIDO, nome: "Segundo" });
    const lista = await (await chamar("/pedidos")).json();
    expect(lista).toHaveLength(2);
    expect(lista[0].nome).toBe("Segundo");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker && npm test -- api
```

Esperado: FAIL — `POST /pedidos` cai na rota 404.

- [ ] **Step 3: Acrescentar `criarPedido` a `worker/src/db.js`**

Adicionar ao final do arquivo:

```js
export async function criarPedido(db, pedido) {
  const criadoEm = new Date().toISOString();
  const { meta } = await db
    .prepare(
      `INSERT INTO pedidos (nome, modelo, tamanho, nome_costas, whats, pago, criado_em)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .bind(
      pedido.nome,
      pedido.modelo,
      pedido.tamanho,
      pedido.nomeCostas,
      pedido.whats || null,
      criadoEm
    )
    .run();

  // Monta a resposta sem a chave `whats`, então paraJson não a inclui.
  return paraJson({
    id: meta.last_row_id,
    nome: pedido.nome,
    modelo: pedido.modelo,
    tamanho: pedido.tamanho,
    nome_costas: pedido.nomeCostas,
    pago: 0,
    criado_em: criadoEm,
  });
}
```

- [ ] **Step 4: Ligar a rota em `worker/src/index.js`**

Trocar a linha de import do topo por:

```js
import { listarPedidos, criarPedido } from "./db.js";
import { validarPedido } from "./validacao.js";
```

Acrescentar o handler antes do `export default`:

```js
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
```

Acrescentar a rota dentro do `try`, logo depois da rota do GET:

```js
      if (rota === "/pedidos" && request.method === "POST") {
        return await postPedido(request, env, origem);
      }
```

- [ ] **Step 5: Rodar e confirmar que passam**

```bash
cd worker && npm test
```

Esperado: PASS, todos os testes.

- [ ] **Step 6: Commit**

```bash
git add worker/ && git commit -m "feat(worker): POST /pedidos com whats fora da listagem publica"
```

---

### Task 4: Token de autenticação

Entrega: módulo puro de hash e token HMAC, sem tocar em rota nenhuma.

**Files:**
- Create: `worker/src/auth.js`
- Test: `worker/test/auth.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `sha256Hex(texto) -> Promise<string>` (64 caracteres hex)
  - `comparaSegura(a: string, b: string) -> boolean`
  - `gerarToken(segredo, agora?) -> Promise<string>`
  - `verificarToken(segredo, token, agora?) -> Promise<boolean>`
  - `verificarLogin(env, usuario, senha) -> Promise<boolean>`
  - `VALIDADE_MS` = 43200000 (12 horas)

- [ ] **Step 1: Escrever os testes que falham**

Criar `worker/test/auth.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  VALIDADE_MS,
  comparaSegura,
  gerarToken,
  sha256Hex,
  verificarLogin,
  verificarToken,
} from "../src/auth.js";

const SEGREDO = "segredo-de-teste";

describe("sha256Hex", () => {
  it("gera hash hex de 64 caracteres", async () => {
    const hash = await sha256Hex("Ultra5*");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("é determinístico e sensível à entrada", async () => {
    expect(await sha256Hex("abc")).toBe(await sha256Hex("abc"));
    expect(await sha256Hex("abc")).not.toBe(await sha256Hex("abd"));
  });
});

describe("comparaSegura", () => {
  it("compara corretamente", () => {
    expect(comparaSegura("igual", "igual")).toBe(true);
    expect(comparaSegura("igual", "IGUAL")).toBe(false);
    expect(comparaSegura("curto", "bem mais longo")).toBe(false);
  });
});

describe("token", () => {
  it("aceita um token recém-gerado", async () => {
    const token = await gerarToken(SEGREDO);
    expect(await verificarToken(SEGREDO, token)).toBe(true);
  });

  it("recusa token assinado com outro segredo", async () => {
    const token = await gerarToken("outro-segredo");
    expect(await verificarToken(SEGREDO, token)).toBe(false);
  });

  it("recusa token com payload adulterado", async () => {
    const token = await gerarToken(SEGREDO);
    const [, assinatura] = token.split(".");
    const falso = `${btoa('{"exp":99999999999999}').replace(/=+$/, "")}.${assinatura}`;
    expect(await verificarToken(SEGREDO, falso)).toBe(false);
  });

  it("recusa token expirado", async () => {
    const passado = Date.now() - VALIDADE_MS - 1000;
    const token = await gerarToken(SEGREDO, passado);
    expect(await verificarToken(SEGREDO, token)).toBe(false);
  });

  it("recusa lixo", async () => {
    expect(await verificarToken(SEGREDO, "")).toBe(false);
    expect(await verificarToken(SEGREDO, "sem-ponto")).toBe(false);
    expect(await verificarToken(SEGREDO, "a.b")).toBe(false);
    expect(await verificarToken(SEGREDO, null)).toBe(false);
  });
});

describe("verificarLogin", () => {
  it("aceita usuário e senha corretos", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("senha-certa") };
    expect(await verificarLogin(env, "madruga", "senha-certa")).toBe(true);
  });

  it("recusa senha errada e usuário errado", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("senha-certa") };
    expect(await verificarLogin(env, "madruga", "senha-errada")).toBe(false);
    expect(await verificarLogin(env, "outro", "senha-certa")).toBe(false);
  });

  it("recusa entradas que não são string", async () => {
    const env = { ADMIN_USER: "madruga", ADMIN_PASS_HASH: await sha256Hex("x") };
    expect(await verificarLogin(env, null, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker && npm test -- auth
```

Esperado: FAIL — `src/auth.js` não existe.

- [ ] **Step 3: Criar `worker/src/auth.js`**

```js
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
```

- [ ] **Step 4: Rodar e confirmar que passam**

```bash
cd worker && npm test -- auth
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth.js worker/test/auth.test.js
git commit -m "feat(worker): hash de senha e token HMAC com validade de 12h"
```

---

### Task 5: Endpoints de admin

Entrega: login, listagem com `whats` e marcação de pago, todos protegidos por token.

**Files:**
- Modify: `worker/src/db.js`, `worker/src/index.js`
- Test: `worker/test/api.test.js`

**Interfaces:**
- Consumes: `gerarToken`, `verificarToken`, `verificarLogin`, `VALIDADE_MS` (Task 4); `listarPedidos` (Task 1)
- Produces: `marcarPago(db, id, pago) -> Promise<Pedido | null>` (null quando o id não existe)

- [ ] **Step 1: Escrever os testes que falham**

Primeiro, acrescentar este import junto dos outros, **no topo** do arquivo:

```js
import { sha256Hex } from "../src/auth.js";
```

Depois, acrescentar ao final de `worker/test/api.test.js`:

```js
const SENHA_TESTE = "senha-de-teste-123";

// O env dos testes não tem os secrets de produção; definimos aqui.
beforeAll(async () => {
  env.ADMIN_USER = "madruga";
  env.ADMIN_PASS_HASH = await sha256Hex(SENHA_TESTE);
  env.TOKEN_SECRET = "segredo-hmac-de-teste";
  env.IP_SALT = "salt-de-teste";
});

async function logar() {
  const resposta = await chamar("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "madruga", senha: SENHA_TESTE }),
  });
  return (await resposta.json()).token;
}

describe("POST /admin/login", () => {
  it("devolve token com credenciais corretas", async () => {
    const resposta = await chamar("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "madruga", senha: SENHA_TESTE }),
    });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(typeof corpo.token).toBe("string");
    expect(corpo.expiraEm).toBeGreaterThan(Date.now());
  });

  it("devolve 401 com senha errada, sem dizer qual campo errou", async () => {
    const resposta = await chamar("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "madruga", senha: "errada" }),
    });
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).erro).toBe("Usuário ou senha incorretos.");
  });
});

describe("GET /admin/pedidos", () => {
  it("devolve 401 sem token", async () => {
    expect((await chamar("/admin/pedidos")).status).toBe(401);
  });

  it("devolve 401 com token forjado", async () => {
    const resposta = await chamar("/admin/pedidos", {
      headers: { Authorization: "Bearer aaaa.bbbb" },
    });
    expect(resposta.status).toBe(401);
  });

  it("devolve whats para o admin autenticado", async () => {
    await postPedido(PEDIDO);
    const token = await logar();
    const resposta = await chamar("/admin/pedidos", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resposta.status).toBe(200);
    const lista = await resposta.json();
    expect(lista[0].whats).toBe("48991311234");
  });
});

describe("PATCH /admin/pedidos/:id", () => {
  it("devolve 401 sem token", async () => {
    const resposta = await chamar("/admin/pedidos/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(401);
  });

  it("marca como pago e o efeito aparece no GET seguinte", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    const token = await logar();
    const resposta = await chamar(`/admin/pedidos/${criado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).pago).toBe(true);

    const lista = await (await chamar("/pedidos")).json();
    expect(lista[0].pago).toBe(true);
  });

  it("devolve 404 para id inexistente", async () => {
    const token = await logar();
    const resposta = await chamar("/admin/pedidos/99999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: true }),
    });
    expect(resposta.status).toBe(404);
  });

  it("devolve 400 quando pago não é booleano", async () => {
    const criado = await (await postPedido(PEDIDO)).json();
    const token = await logar();
    const resposta = await chamar(`/admin/pedidos/${criado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pago: "sim" }),
    });
    expect(resposta.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker && npm test -- api
```

Esperado: FAIL — rotas de admin caem no 404.

- [ ] **Step 3: Acrescentar `marcarPago` a `worker/src/db.js`**

Adicionar ao final do arquivo:

```js
export async function marcarPago(db, id, pago) {
  const { meta } = await db
    .prepare("UPDATE pedidos SET pago = ? WHERE id = ?")
    .bind(pago ? 1 : 0, id)
    .run();
  if (meta.changes === 0) return null;

  const linha = await db
    .prepare(`SELECT ${CAMPOS_ADMIN} FROM pedidos WHERE id = ?`)
    .bind(id)
    .first();
  return paraJson(linha);
}
```

- [ ] **Step 4: Ligar as rotas em `worker/src/index.js`**

Trocar os imports do topo por:

```js
import { listarPedidos, criarPedido, marcarPago } from "./db.js";
import { validarPedido } from "./validacao.js";
import { VALIDADE_MS, gerarToken, verificarLogin, verificarToken } from "./auth.js";
```

Acrescentar os handlers antes do `export default`:

```js
async function postLogin(request, env, origem) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
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
  if (typeof corpo.pago !== "boolean") {
    return erro("Campo 'pago' deve ser true ou false.", 400, origem);
  }

  const pedido = await marcarPago(env.DB, id, corpo.pago);
  if (!pedido) return erro("Pedido não encontrado.", 404, origem);
  return json(pedido, 200, origem);
}
```

Acrescentar as rotas dentro do `try`, antes do `return erro("Rota não encontrada."...)`:

```js
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
```

- [ ] **Step 5: Rodar e confirmar que passam**

```bash
cd worker && npm test
```

Esperado: PASS, todos os testes.

- [ ] **Step 6: Commit**

```bash
git add worker/ && git commit -m "feat(worker): endpoints de admin com login, listagem e marcar pago"
```

---

### Task 6: Limite de envios por IP

Entrega: `POST /pedidos` limitado a 5 por IP por hora, guardando só o hash do IP.

**Files:**
- Create: `worker/src/rateLimit.js`
- Modify: `worker/src/index.js`
- Test: `worker/test/api.test.js`

**Interfaces:**
- Consumes: `sha256Hex` (Task 4)
- Produces:
  - `hashIp(ip, salt) -> Promise<string>`
  - `dentroDoLimite(db, ipHash, agora?) -> Promise<boolean>`
  - `registrarEnvio(db, ipHash, agora?) -> Promise<void>`
  - `limparAntigos(db, agora?) -> Promise<void>`
  - `LIMITE` = 5, `JANELA_MS` = 3600000

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `worker/test/api.test.js`:

```js
describe("limite de envios", () => {
  function postComIp(ip) {
    return chamar("/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(PEDIDO),
    });
  }

  it("aceita 5 pedidos do mesmo IP e recusa o sexto", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await postComIp("203.0.113.7")).status).toBe(201);
    }
    const sexto = await postComIp("203.0.113.7");
    expect(sexto.status).toBe(429);
    expect((await sexto.json()).erro).toMatch(/tente novamente/i);
  });

  it("não penaliza um IP diferente", async () => {
    for (let i = 0; i < 5; i++) await postComIp("203.0.113.7");
    expect((await postComIp("203.0.113.8")).status).toBe(201);
  });

  it("guarda o hash do IP, nunca o IP em si", async () => {
    await postComIp("203.0.113.7");
    const { results } = await env.DB.prepare("SELECT ip_hash FROM rate_limit").all();
    expect(results).toHaveLength(1);
    expect(results[0].ip_hash).not.toContain("203.0.113.7");
    expect(results[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd worker && npm test -- api
```

Esperado: FAIL — o sexto pedido devolve 201 em vez de 429.

- [ ] **Step 3: Criar `worker/src/rateLimit.js`**

```js
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
```

- [ ] **Step 4: Ligar no handler em `worker/src/index.js`**

Acrescentar aos imports do topo:

```js
import { dentroDoLimite, hashIp, limparAntigos, registrarEnvio } from "./rateLimit.js";
```

Substituir o corpo de `postPedido` por:

```js
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
```

- [ ] **Step 5: Rodar e confirmar que passam**

```bash
cd worker && npm test
```

Esperado: PASS, todos os testes.

- [ ] **Step 6: Commit**

```bash
git add worker/ && git commit -m "feat(worker): limite de 5 pedidos por IP por hora"
```

---

### Task 7: Deploy do Worker e do banco

Entrega: API no ar, com secrets configurados. **Esta task exige ações do usuário no navegador** — o agente deve parar e pedir, não tentar contornar.

**Files:**
- Modify: `worker/wrangler.toml` (substituir `database_id`)

**Interfaces:**
- Consumes: todo o Worker das tasks 1-6
- Produces: a URL pública do Worker, necessária na Task 8

- [ ] **Step 1: Pedir ao usuário que crie a conta e faça login**

Parar e pedir ao usuário:

> Crie uma conta gratuita em https://dash.cloudflare.com/sign-up (só e-mail e senha, sem cartão). Depois me avise para eu rodar o login.

Quando confirmar, rodar:

```bash
cd worker && npx wrangler login
```

Isso abre o navegador para autorizar. Esperado: `Successfully logged in.`

- [ ] **Step 2: Criar o banco D1**

```bash
cd worker && npx wrangler d1 create madruga_pedidos
```

Esperado: saída contendo um bloco com `database_id = "<uuid>"`.

- [ ] **Step 3: Colar o `database_id` real em `wrangler.toml`**

Substituir `database_id = "substituir-na-task-7"` pelo uuid devolvido no passo anterior.

- [ ] **Step 4: Aplicar o schema no banco remoto**

```bash
cd worker && npx wrangler d1 execute madruga_pedidos --remote --file=./schema.sql
```

Esperado: confirmação de comandos executados com sucesso.

- [ ] **Step 5: Definir os secrets**

O usuário digita a senha nova diretamente no terminal. Ela não deve ser escrita em arquivo nenhum, nem colada no chat.

Primeiro, gerar o hash da senha nova. Pedir ao usuário que rode (a senha fica só no histórico do shell dele):

```bash
read -rs SENHA && printf %s "$SENHA" | sha256sum | cut -d' ' -f1 && unset SENHA
```

Depois, com o hash em mãos:

```bash
cd worker
npx wrangler secret put ADMIN_USER       # digitar: madruga
npx wrangler secret put ADMIN_PASS_HASH  # colar o hash gerado acima
npx wrangler secret put TOKEN_SECRET     # colar: openssl rand -hex 32
npx wrangler secret put IP_SALT          # colar: openssl rand -hex 16
```

Os dois últimos valores são gerados com:

```bash
openssl rand -hex 32
openssl rand -hex 16
```

- [ ] **Step 6: Publicar o Worker**

```bash
cd worker && npx wrangler deploy
```

Esperado: saída com a URL `https://madruga-pedidos.<subdominio>.workers.dev`. **Anotar essa URL** — ela é usada na Task 8.

- [ ] **Step 7: Verificar que a API responde**

```bash
curl -s -H "Origin: https://paes.github.io" https://madruga-pedidos.<subdominio>.workers.dev/pedidos
```

Esperado: `[]`

- [ ] **Step 8: Commit**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): apontar wrangler.toml para o banco D1 criado"
```

---

### Task 8: Trocar `window.storage` por `fetch` no `index.html`

Entrega: a página consumindo a API real. Nenhuma mudança de layout, CSS ou HTML — só o bloco `<script>`.

**Files:**
- Modify: `index.html` (bloco `<script>` a partir da linha 711)

**Interfaces:**
- Consumes: a URL do Worker (Task 7) e todos os endpoints (Tasks 1, 3, 5)
- Produces: página funcional (verificada na Task 9)

- [ ] **Step 1: Adicionar a constante da API**

Em `index.html`, logo depois de `(function(){`, antes de `const form = ...`, inserir:

```js
  // API em Cloudflare Workers. Trocar caso o Worker mude de nome/conta.
  const API_URL = 'https://madruga-pedidos.<subdominio>.workers.dev';
  let adminToken = sessionStorage.getItem('madruga_admin_token') || null;
```

Substituir `<subdominio>` pela URL real anotada na Task 7.

- [ ] **Step 2: Substituir `loadOrders`**

Trocar a função `loadOrders` inteira (de `async function loadOrders(){` até o `}` que a fecha, hoje nas linhas 819-845) por:

```js
  async function loadOrders(){
    const usandoAdmin = isAdminLoggedIn && adminToken;
    const url = API_URL + (usandoAdmin ? '/admin/pedidos' : '/pedidos');
    const opcoes = usandoAdmin
      ? { headers: { 'Authorization': 'Bearer ' + adminToken } }
      : {};

    try{
      const resposta = await fetch(url, opcoes);

      // Token expirado ou inválido: devolve o admin para a tela de login.
      if(usandoAdmin && resposta.status === 401){
        deslogarAdmin();
        return;
      }
      if(!resposta.ok) throw new Error('Resposta ' + resposta.status);

      const orders = await resposta.json();
      cachedOrders = orders;
      renderOrders(cachedOrders);
      if(isAdminLoggedIn) renderAdminTable(cachedOrders);
    }catch(e){
      console.error('Erro ao carregar pedidos', e);
      // A página é antes de tudo uma vitrine: se a API cair, o resto
      // continua legível em vez de quebrar.
      if(cachedOrders.length === 0) renderOrders([]);
    }
  }
```

- [ ] **Step 3: Remover as constantes de senha e adicionar `deslogarAdmin`**

Trocar as linhas:

```js
  const ADMIN_USER = 'madruga';
  const ADMIN_PASS = 'Ultra5*';
  let isAdminLoggedIn = false;
```

por:

```js
  let isAdminLoggedIn = false;

  function deslogarAdmin(){
    isAdminLoggedIn = false;
    adminToken = null;
    sessionStorage.removeItem('madruga_admin_token');
    adminLoginView.style.display = 'block';
    adminDashView.style.display = 'none';
    adminErr.textContent = 'Sua sessão expirou. Entre de novo.';
  }
```

- [ ] **Step 4: Substituir o submit do formulário de login**

Trocar o listener inteiro:

```js
  adminLoginForm.addEventListener('submit', function(e){
    e.preventDefault();
    const user = document.getElementById('adminUser').value.trim();
    const pass = document.getElementById('adminPass').value;
    if(user === ADMIN_USER && pass === ADMIN_PASS){
      isAdminLoggedIn = true;
      adminErr.textContent = '';
      adminLoginForm.reset();
      openAdmin();
    } else {
      adminErr.textContent = 'Usuário ou senha incorretos.';
    }
  });
```

por:

```js
  adminLoginForm.addEventListener('submit', async function(e){
    e.preventDefault();
    adminErr.textContent = '';
    const user = document.getElementById('adminUser').value.trim();
    const pass = document.getElementById('adminPass').value;

    try{
      const resposta = await fetch(API_URL + '/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: user, senha: pass })
      });

      if(!resposta.ok){
        adminErr.textContent = 'Usuário ou senha incorretos.';
        return;
      }

      const dados = await resposta.json();
      adminToken = dados.token;
      sessionStorage.setItem('madruga_admin_token', adminToken);
      isAdminLoggedIn = true;
      adminLoginForm.reset();
      openAdmin();
    }catch(err){
      console.error(err);
      adminErr.textContent = 'Não foi possível entrar agora. Tente de novo.';
    }
  });
```

- [ ] **Step 5: Ajustar o logout**

Trocar:

```js
  adminLogoutBtn.addEventListener('click', function(){
    isAdminLoggedIn = false;
    closeAdmin();
  });
```

por:

```js
  adminLogoutBtn.addEventListener('click', function(){
    isAdminLoggedIn = false;
    adminToken = null;
    sessionStorage.removeItem('madruga_admin_token');
    closeAdmin();
    loadOrders();
  });
```

- [ ] **Step 6: Trocar `data-key` por `data-id` em `renderAdminTable`**

Na string do botão, trocar:

```js
        '<td><button type="button" class="pago-toggle-btn" data-key="' + escapeHtml(o.key) + '" data-pago="' + (o.pago ? '1' : '0') + '">' + toggleLabel + '</button></td>' +
```

por:

```js
        '<td><button type="button" class="pago-toggle-btn" data-id="' + o.id + '" data-pago="' + (o.pago ? '1' : '0') + '">' + toggleLabel + '</button></td>' +
```

- [ ] **Step 7: Substituir o handler do botão "marcar pago"**

Trocar o corpo do listener (hoje linhas 930-946) por:

```js
    adminOrdersBody.querySelectorAll('.pago-toggle-btn').forEach(function(btn){
      btn.addEventListener('click', async function(){
        const id = btn.dataset.id;
        const wasPago = btn.dataset.pago === '1';
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        try{
          const resposta = await fetch(API_URL + '/admin/pedidos/' + id, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + adminToken
            },
            body: JSON.stringify({ pago: !wasPago })
          });
          if(resposta.status === 401){ deslogarAdmin(); return; }
          if(!resposta.ok) throw new Error('Resposta ' + resposta.status);
          await loadOrders();
        }catch(err){
          console.error(err);
          btn.disabled = false;
          btn.textContent = wasPago ? 'Marcar pendente' : 'Marcar pago';
        }
      });
    });
```

- [ ] **Step 8: Substituir o submit do formulário de pedido**

No listener de `form`, trocar o bloco que monta `order` e a chave, e o `try` inteiro. O objeto `order` perde o `ts` (o servidor carimba):

```js
    const order = {
      nome: document.getElementById('nome').value.trim(),
      modelo: modeloSelect.value,
      tamanho: tamanhoSelect.value,
      nomeCostas: document.getElementById('nomeCostas').value.trim(),
      whats: document.getElementById('whats').value.trim()
    };

    if(!order.nome || !order.modelo || !order.tamanho || !order.nomeCostas){
      formMsg.textContent = 'Preencha todos os campos obrigatórios.';
      formMsg.className = 'form-msg err';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirmar pedido';
      return;
    }

    try{
      const resposta = await fetch(API_URL + '/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });

      if(!resposta.ok){
        const dados = await resposta.json().catch(function(){ return {}; });
        formMsg.textContent = dados.erro || 'Não foi possível enviar agora. Tente novamente.';
        formMsg.className = 'form-msg err';
        return;
      }

      const criado = await resposta.json();
      formMsg.textContent = 'Pedido confirmado! Não esqueça de enviar o comprovante do Pix.';
      formMsg.className = 'form-msg ok';
      form.reset();
      tamanhoSelect.innerHTML = '<option value="" disabled selected>Escolha o modelo primeiro</option>';
      tamanhoSelect.disabled = true;

      // Atualização otimista: mostra na lista na hora. A escrita no D1 já
      // está consistente para a próxima leitura, então não é preciso
      // recarregar várias vezes como antes.
      cachedOrders = [criado].concat(cachedOrders);
      renderOrders(cachedOrders);
    }catch(err){
      console.error(err);
      formMsg.textContent = 'Não foi possível enviar agora. Tente novamente.';
      formMsg.className = 'form-msg err';
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirmar pedido';
    }
```

Isso remove a variável `key`, o `window.storage.set` e os dois `setTimeout(loadOrders, ...)`.

- [ ] **Step 9: Aumentar o intervalo de atualização**

Trocar, no final da IIFE:

```js
  loadOrders();
  setInterval(loadOrders, 5000);
```

por:

```js
  loadOrders();
  // 30s em vez de 5s: cada aba aberta gera ~2.900 requisições/dia em vez de
  // ~17.000, o que mantém folga confortável no limite gratuito do Worker.
  setInterval(loadOrders, 30000);
```

- [ ] **Step 10: Confirmar que não sobrou nenhuma referência antiga**

```bash
grep -n "window.storage\|ADMIN_PASS\|ADMIN_USER\|data-key\|orders:" index.html
```

Esperado: nenhuma saída.

- [ ] **Step 11: Commit**

```bash
git add index.html
git commit -m "feat: consumir a API do Worker no lugar do window.storage"
```

---

### Task 9: Verificação ponta a ponta e publicação

Entrega: tudo funcionando na URL pública, confirmado por observação direta.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo
- Produces: sistema em produção

- [ ] **Step 1: Rodar a suíte completa**

```bash
cd worker && npm test
```

Esperado: PASS em todos os testes das tasks 1-6.

- [ ] **Step 2: Publicar a página**

```bash
git push
```

Aguardar ~1 min pelo rebuild do GitHub Pages.

- [ ] **Step 3: Conferir que a página no ar já tem a API**

```bash
curl -s https://paes.github.io/madruga-sports-ultra/ | grep -c "workers.dev"
```

Esperado: `1` ou mais. Se der `0`, o Pages ainda não rebuildou — esperar e repetir.

- [ ] **Step 4: Verificar o fluxo público pelo navegador**

Abrir https://paes.github.io/madruga-sports-ultra/, preencher o formulário e enviar. Confirmar:
- a mensagem "Pedido confirmado!" aparece;
- o pedido entra na lista da página;
- recarregando a página (F5), o pedido **continua lá** — esta é a prova de que o problema original foi resolvido.

- [ ] **Step 5: Verificar que o telefone não vaza**

Na aba Rede do navegador (F12), achar a requisição `GET /pedidos` e inspecionar a resposta.

Esperado: nenhum campo `whats`, nenhum número de telefone. Confirmar também por linha de comando:

```bash
curl -s -H "Origin: https://paes.github.io" https://madruga-pedidos.<subdominio>.workers.dev/pedidos | grep -c whats
```

Esperado: `0`

- [ ] **Step 6: Verificar o painel de admin**

Abrir o painel na página, entrar com `madruga` e a senha nova. Confirmar:
- a tabela lista os pedidos **com** a coluna de WhatsApp;
- clicar em "Marcar pago" muda o selo para "Pago";
- recarregar a página e reabrir o painel: o pedido continua marcado como pago;
- a senha antiga (`Ultra5*`) **não** funciona mais.

- [ ] **Step 7: Atualizar o `README.md`**

Substituir a seção "⚠️ O ponto mais importante antes de continuar" inteira por:

```markdown
## Como os pedidos são armazenados

Os pedidos são gravados de verdade, num banco Cloudflare D1, através de uma API
em Cloudflare Workers que fica em `worker/`. A página no GitHub Pages conversa
com essa API por `fetch`.

O WhatsApp do cliente só é devolvido para o administrador autenticado: o
endpoint público `GET /pedidos` nunca inclui esse campo. A separação acontece no
servidor, não no navegador.

O login do admin usa usuário e senha guardados como secrets do Worker
(`wrangler secret put`) — não estão em nenhum arquivo deste repositório.

Detalhes do desenho em `docs/superpowers/specs/2026-07-24-armazenamento-pedidos-design.md`.
```

Na seção "Pontos fixos", remover a linha sobre `ADMIN_USER`/`ADMIN_PASS` e trocar por:

```markdown
- Login do admin: usuário `madruga`, senha guardada como secret do Worker. Para
  trocar: `cd worker && npx wrangler secret put ADMIN_PASS_HASH` com o SHA-256
  da senha nova.
```

- [ ] **Step 8: Commit e push**

```bash
git add README.md
git commit -m "docs: atualizar README para o armazenamento real em D1"
git push
```

---

## Notas de manutenção

- **A grade de modelos/tamanhos vive em dois lugares:** `SIZES` no `index.html` e `GRADE` em `worker/src/validacao.js`. Se a coleção mudar, os dois precisam mudar juntos, senão a página oferece um tamanho que a API rejeita. Duplicação aceita conscientemente: unificar exigiria build step, e a página é um arquivo único por design.
- **Trocar a senha do admin:** gerar o SHA-256 da nova e rodar `npx wrangler secret put ADMIN_PASS_HASH`. Não precisa mexer em código nem republicar a página.
- **A senha `Ultra5*` continua visível no histórico do git** (commits anteriores a este trabalho). Ela deixa de ter qualquer valor depois da Task 7, mas se incomodar, o histórico pode ser reescrito com `git filter-repo`.
