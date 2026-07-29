# Madruga Sports Ultra — página de divulgação + pedidos

**Site no ar:** https://madruga-sports.pages.dev

## O que tem aqui

- `index.html` — a página inteira (catálogo, grade de medidas, formulário de pedido, lista de pedidos, painel admin). É um arquivo único, com as imagens já embutidas nele (base64), então funciona sozinho — não precisa da pasta `assets/` pra rodar.
- `assets/` — as mesmas imagens usadas na página, mas soltas em arquivos `.jpg` separados. Deixei aqui pra facilitar se você quiser trocar alguma foto, editar num programa de imagem, ou usar num editor de código sem lidar com a bagunça de base64 dentro do HTML.
- `worker/` — a API que grava os pedidos (Cloudflare Workers + banco D1).
- `docs/superpowers/` — o desenho e o plano de implementação do armazenamento.

## Como os pedidos são armazenados

Os pedidos são gravados de verdade, num banco Cloudflare D1, através de uma API em Cloudflare Workers que fica em `worker/`. A página conversa com essa API por `fetch`.

Três peças:

| Peça | O quê | Onde |
|---|---|---|
| Site | `index.html` + imagens | Cloudflare Pages — https://madruga-sports.pages.dev |
| API | Worker `madruga-pedidos` | https://madruga-pedidos.understencil.workers.dev |
| Banco | D1 `madruga_pedidos` | só acessível pelo Worker |

**O WhatsApp do cliente só é devolvido para o administrador autenticado.** O endpoint público `GET /pedidos` nunca inclui esse campo — a consulta pública nem seleciona a coluna. A separação acontece no servidor, não no navegador: por isso o telefone não vaza nem para quem abre o DevTools.

O login do admin usa usuário e senha guardados como secrets do Worker. Não estão em nenhum arquivo deste repositório nem no código da página.

Detalhes do desenho em [`docs/superpowers/specs/2026-07-24-armazenamento-pedidos-design.md`](docs/superpowers/specs/2026-07-24-armazenamento-pedidos-design.md).

## Mexendo no projeto

### Configuração inicial (só numa conta Cloudflare nova)

Se você clonou este repo e vai subir tudo do zero. Pulando qualquer passo daqui,
o Worker sobe mas todo pedido devolve 500 e o login nunca funciona — sem pista
nenhuma do motivo.

```bash
cd worker
npx wrangler login

# 1. Banco. Copie o database_id da saída para o wrangler.toml.
npx wrangler d1 create madruga_pedidos

# 2. Tabelas.
npx wrangler d1 execute madruga_pedidos --remote --file=./schema.sql

# 3. Os quatro secrets. Sem qualquer um deles a API não funciona.
printf 'madruga' | npx wrangler secret put ADMIN_USER
openssl rand -hex 32 | tr -d '\n' | npx wrangler secret put TOKEN_SECRET
openssl rand -hex 16 | tr -d '\n' | npx wrangler secret put IP_SALT

# A senha do admin: o comando abaixo lê sem exibir e imprime só o hash.
read -rs SENHA && printf %s "$SENHA" | sha256sum | cut -d' ' -f1 && unset SENHA
npx wrangler secret put ADMIN_PASS_HASH   # cole o hash

# 4. Publicar.
npx wrangler deploy
npx wrangler pages project create madruga-sports --production-branch main
```

**Importante:** a constante `ORIGEM_PERMITIDA` em `worker/src/index.js` precisa
bater exatamente com a URL do site. Se o endereço do Pages for outro, mude lá e
no `ORIGEM` de `worker/test/api.test.js`, senão o navegador bloqueia todas as
chamadas por CORS e a página fica sem gravar nada.

### Publicar uma alteração na página

Editou o `index.html`? Publique assim:

```bash
rm -rf dist && mkdir -p dist && cp index.html dist/ && cp -r assets dist/
cd worker && npx wrangler pages deploy ../dist --project-name=madruga-sports --branch=main
```

### Publicar uma alteração na API

```bash
cd worker && npm test && npx wrangler deploy
```

Rode os testes antes — são 65 e cobrem, entre outras coisas, a garantia de que o telefone não vaza na listagem pública.

### Trocar a senha do admin

```bash
read -rs SENHA && printf %s "$SENHA" | sha256sum | cut -d' ' -f1 && unset SENHA
cd worker && npx wrangler secret put ADMIN_PASS_HASH
```

Cole o hash quando pedir. Não precisa mexer em código nem republicar a página.

### Ver os pedidos por fora do painel

```bash
cd worker && npx wrangler d1 execute madruga_pedidos --remote --command "SELECT * FROM pedidos ORDER BY criado_em DESC"
```

## Decisões conscientes (não são descuido)

- **A senha do admin é guardada como SHA-256 simples, sem sal.** A revisão apontou que, se esse hash vazar, uma senha escolhida por humano cai em força bruta offline rapidamente, e recomendou PBKDF2. A escolha foi manter SHA-256 pela simplicidade do projeto. Se um dia quiser endurecer isso, o runtime do Workers já tem `crypto.subtle.deriveBits` — não precisa de dependência nova. A compensação enquanto isso: use uma senha longa e não reaproveitada.
- **A grade de tamanhos existe em dois lugares:** `SIZES` no `index.html` e `GRADE` em `worker/src/validacao.js`. Se a coleção mudar, os dois precisam mudar juntos, senão a página oferece um tamanho que a API rejeita. Não foram unificados porque a página é um arquivo único autocontido por design, sem etapa de build.
- **Limite de 5 pedidos por IP por hora.** Se a assessoria tiver gente pedindo junta no mesmo Wi-Fi, esse limite pode barrar pedido legítimo. O número está em `worker/src/rateLimit.js` (`LIMITE`).
- **A senha antiga `Ultra5*` continua visível no histórico do git.** Ela não vale mais para nada desde que o login passou a ser no servidor, mas está lá nos commits antigos.

## Estrutura da página (`index.html`)

- CSS no `<head>`, dentro de `<style>`.
- HTML do conteúdo (hero, sobre, catálogo, medidas, formulário, lista, admin) no `<body>`.
- JS no final do arquivo, dentro de `<script>`, tudo dentro de uma única IIFE `(function(){ ... })();`.

Pontos fixos que talvez você queira revisar/trocar:

- Chave Pix: `alexvafmadruga@gmail.com`
- WhatsApp da assessoria: `+55 48 9131-1234`
- Endereço da API: constante `API_URL`, no começo da IIFE.
- Login do admin: usuário `madruga`; a senha é secret do Worker (veja acima como trocar).
