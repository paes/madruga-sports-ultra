# Armazenamento real de pedidos — Madruga Sports Ultra

Data: 2026-07-24

## Problema

A página está no ar em https://paes.github.io/madruga-sports-ultra/ (GitHub Pages,
repositório público `paes/madruga-sports-ultra`), mas os pedidos não são gravados
em lugar nenhum.

O código usa `window.storage`, uma API que só existe dentro do ambiente de
artifacts da Claude. Fora dali ela não existe, então:

- o formulário aceita o preenchimento, diz "Pedido confirmado!" e o pedido evapora;
- a lista pública e o painel admin ficam permanentemente vazios.

Além disso, o login do admin é decorativo: `ADMIN_USER = 'madruga'` e
`ADMIN_PASS = 'Ultra5*'` são constantes no JavaScript e a comparação roda no
navegador. Como o `index.html` é servido publicamente, a senha é legível por
qualquer visitante.

## Requisitos

Definidos com o usuário:

1. O administrador gerencia os pedidos **pelo painel da própria página** (não por
   planilha, e-mail ou WhatsApp).
2. A lista de pedidos **continua pública** na página, com nome do cliente e nome
   nas costas, para efeito de prova social.
3. O **WhatsApp do cliente é sensível**: aparece só para o administrador
   autenticado, nunca na lista pública.
4. Hospedagem e banco gratuitos. Supabase está descartado (limite da conta do
   usuário já atingido).

O requisito 3 combinado com o 2 é o que determina a arquitetura: a filtragem do
telefone precisa acontecer no servidor. Qualquer solução em que o navegador fale
direto com o banco vaza o dado — se o navegador tem credencial para ler a lista,
ele lê o telefone junto.

## Decisão de arquitetura

**Cloudflare Workers + D1**, com a página permanecendo no GitHub Pages.

Alternativas consideradas e descartadas:

- **Firebase Firestore** — as regras de segurança são por documento, não por
  campo. Esconder apenas o `whats` exigiria duplicar cada pedido em duas coleções
  (uma pública sem telefone, uma privada com), criando dois pontos de escrita que
  podem dessincronizar. Descartado por causa do requisito 3.
- **Google Sheets + Apps Script** — viável e sem conta nova, mas o deploy é manual
  pela interface do Apps Script, a latência por chamada fica em 1-2s e o CORS no
  POST exige contornos. Descartado por ergonomia, não por limitação técnica.

### Peças

| Peça | Responsabilidade |
|---|---|
| GitHub Pages | Serve o `index.html`. URL não muda. |
| Worker `madruga-pedidos` | Única coisa que fala com o banco. Decide, por requisição, quem vê o campo `whats`. |
| D1 `madruga_pedidos` | Persistência. Inacessível de fora do Worker. |

O navegador nunca possui credencial de banco. O Worker aceita CORS apenas da
origem `https://paes.github.io`.

### Fluxo

```
Visitante abre a página   → GET   /pedidos            → lista SEM whats
Visitante manda pedido    → POST  /pedidos            → grava, devolve SEM whats
Admin entra no painel     → POST  /admin/login        → devolve token (12h)
                          → GET   /admin/pedidos      → lista COM whats
                          → PATCH /admin/pedidos/:id  → marca pago
```

## Modelo de dados

```sql
CREATE TABLE pedidos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT    NOT NULL,
  modelo      TEXT    NOT NULL,
  tamanho     TEXT    NOT NULL,
  nome_costas TEXT    NOT NULL,
  whats       TEXT,
  pago        INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT    NOT NULL          -- ISO 8601, UTC
);

CREATE INDEX idx_pedidos_criado_em ON pedidos (criado_em DESC);

CREATE TABLE rate_limit (
  ip_hash    TEXT NOT NULL,
  criado_em  TEXT NOT NULL
);

CREATE INDEX idx_rate_limit ON rate_limit (ip_hash, criado_em);
```

`criado_em` é carimbado pelo servidor. Hoje o `ts` vem do relógio do navegador do
visitante (`index.html:963`), o que é forjável e quebra a ordenação quando o
relógio do cliente está errado.

## API

Todas as respostas são JSON. Erros seguem `{ "erro": "<mensagem legível>" }` com
o status HTTP apropriado.

O Worker traduz entre o formato do banco e o formato que o JavaScript da página já
usa, para manter as mudanças no `index.html` mínimas:

| coluna no D1 | campo no JSON | observação |
|---|---|---|
| `nome_costas` | `nomeCostas` | |
| `criado_em` | `ts` | nome que o `renderOrders` já espera |
| `pago` (INTEGER 0/1) | `pago` (boolean) | |
| demais | mesmo nome | |

### `GET /pedidos` — anônimo

Devolve todos os pedidos ordenados por `criado_em` decrescente, **sem o campo
`whats`**:

```json
[{ "id": 12, "nome": "...", "modelo": "...", "tamanho": "...",
   "nomeCostas": "...", "pago": false, "ts": "2026-07-24T18:03:00Z" }]
```

### `POST /pedidos` — anônimo

Corpo: `{ nome, modelo, tamanho, nomeCostas, whats }`.

Validação no servidor (rejeita com 400):

- `nome`, `modelo`, `tamanho`, `nomeCostas` obrigatórios e não vazios após trim.
- `nome` ≤ 80 caracteres; `nomeCostas` ≤ 30; `whats` ≤ 20 e opcional.
- O par `(modelo, tamanho)` precisa existir nesta tabela, espelhando a grade da
  página (`index.html`, constante `SIZES`):

  | modelo | tamanhos aceitos |
  |---|---|
  | `Camiseta Fundo Preto` | PP, P, M, G, GG, XG |
  | `Camiseta Fundo Laranja` | PP, P, M, G, GG, XG |
  | `Regata` | PP, P, M, G, GG |
  | `Camiseta Infantil (Citrino)` | 2, 4, 6, 8, 10, 12, 14 |

  A validação é do par, não de cada campo isolado: `Regata` + `XG` é inválido.

`pago` é sempre gravado como `0` e `criado_em` como o horário do servidor —
ambos ignoram o que o cliente mandar. Resposta: 201 com o pedido criado, sem
`whats`.

**Limite de abuso.** O endpoint é aberto na internet; sem limite, a lista pública
do cliente pode ser inundada em minutos. Máximo de 5 pedidos por IP por hora
(429 ao estourar). Guarda-se `SHA-256(ip + salt)`, nunca o IP em si; o salt é um
secret do Worker. Linhas de `rate_limit` com mais de 1 hora são apagadas
oportunisticamente a cada `POST`.

### `POST /admin/login`

Corpo: `{ usuario, senha }`. Compara com os secrets do Worker. Devolve
`{ token, expiraEm }` ou 401. O 401 é genérico ("usuário ou senha incorretos"),
sem distinguir qual dos dois errou.

### `GET /admin/pedidos`

Exige `Authorization: Bearer <token>`. Mesma lista do endpoint público, **com** o
campo `whats`. 401 se o token faltar, estiver expirado ou tiver assinatura inválida.

### `PATCH /admin/pedidos/:id`

Exige token. Corpo: `{ pago: true|false }`. Devolve o pedido atualizado. 404 se o
`id` não existir.

## Autenticação

- `ADMIN_USER`, `ADMIN_PASS_HASH` (SHA-256 da senha), `TOKEN_SECRET` e `IP_SALT`
  são secrets do Worker (`wrangler secret put`). Não vão para o git nem para o HTML.
- A comparação do hash é feita em tempo constante, para não vazar informação pela
  diferença de tempo de resposta.
- O token é `base64url(payload) + "." + base64url(HMAC-SHA256(payload, TOKEN_SECRET))`,
  com `payload = { exp: <epoch ms> }`. Validade de 12 horas. Sem tabela de sessão:
  o Worker só verifica assinatura e expiração.
- No navegador o token fica em `sessionStorage`, não `localStorage` — expira ao
  fechar a aba, o que importa em celular emprestado ou compartilhado.

**A senha atual está queimada.** `Ultra5*` foi servida publicamente no `index.html`
e está no histórico do repositório público. A implementação exige definir uma
senha nova; reaproveitar essa não é opção. Reescrever o histórico do git não é
necessário para a segurança do sistema novo (a senha antiga deixa de valer para
qualquer coisa), mas fica registrado que ela permanece visível nos commits
anteriores.

## Mudanças no `index.html`

Cirúrgicas — a estrutura, o CSS e o layout da página não mudam.

| Hoje | Vira |
|---|---|
| `window.storage.list` + `.get` (`:821`, `:831`) | `GET /pedidos` ou `GET /admin/pedidos` conforme o estado de login |
| `window.storage.set` no submit (`:979`) | `POST /pedidos` |
| `window.storage.set` no toggle pago (`:940`) | `PATCH /admin/pedidos/:id` |
| comparação de senha no JS (`:857`) | `POST /admin/login` |

Também:

- Entra a constante `API_URL` no topo da IIFE.
- Saem as constantes `ADMIN_USER` e `ADMIN_PASS`.
- A chave `key: 'orders:<ts>-<rand>'` some; passa a ser o `id` numérico. Os
  `data-key` dos botões viram `data-id`.
- Saem os `setTimeout(loadOrders, 1200)` e `setTimeout(loadOrders, 4000)`
  (`:990-991`), que existiam só para contornar o atraso de propagação do storage
  da Claude. A escrita no D1 é consistente na leitura seguinte; a atualização
  otimista já existente basta.

## Tratamento de erros

- Falha de rede no envio do pedido: cai no `catch` que já existe e mostra "Não foi
  possível enviar agora. Tente novamente." O botão volta a ficar habilitado.
- Falha ao carregar a lista pública: mostra o estado vazio em vez de quebrar a
  página. A página é primariamente uma vitrine; ela precisa continuar legível
  mesmo com a API fora do ar.
- Token expirado ou inválido durante o uso do painel: limpa o `sessionStorage` e
  devolve o admin para a tela de login.
- 429 no envio: mensagem específica pedindo para tentar mais tarde.

## Testes

Rodando o Worker local (`wrangler dev`) contra D1 local, antes de qualquer deploy:

1. `POST /pedidos` válido grava e devolve 201.
2. `POST /pedidos` rejeita: campo obrigatório vazio; `nome` com 500 caracteres;
   `modelo` fora da lista; par inválido (`Regata` + `XG`).
3. **`GET /pedidos` nunca inclui `whats`** — verificado inspecionando o JSON bruto,
   inclusive para um pedido que foi criado com telefone preenchido. É a asserção
   central do requisito de privacidade.
4. `GET /admin/pedidos` e `PATCH` retornam 401 sem token, com token forjado e com
   token expirado.
5. `PATCH` com token válido alterna `pago` e o efeito aparece no `GET` seguinte.
6. `POST /pedidos` retorna 429 na sexta tentativa dentro de uma hora.
7. Requisição com `Origin` diferente de `https://paes.github.io` é barrada por CORS.

Após o deploy: um pedido de ponta a ponta na página real, login no painel, marcar
pago, e conferir na aba de rede que a resposta pública não traz telefone.

## Fora de escopo

- Notificação (e-mail/WhatsApp) ao administrador quando chega pedido.
- Exportar pedidos para planilha ou CSV.
- Editar ou excluir pedidos pelo painel.
- Integração com o Pix (confirmação de pagamento continua manual).
- Múltiplos usuários administradores.
