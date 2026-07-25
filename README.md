# Madruga Sports Ultra — página de divulgação + pedidos

## O que tem aqui

- `index.html` — a página inteira (catálogo, grade de medidas, formulário de pedido, lista de pedidos, painel admin). É um arquivo único, com as imagens já embutidas nele (base64), então funciona sozinho — não precisa da pasta `assets/` pra rodar.
- `assets/` — as mesmas imagens usadas na página, mas soltas em arquivos `.jpg` separados. Deixei aqui pra facilitar se você quiser trocar alguma foto, editar num programa de imagem, ou usar num editor de código sem lidar com a bagunça de base64 dentro do HTML.

## ⚠️ O ponto mais importante antes de continuar

A lista de pedidos e o painel de admin (marcar pagamento) **não funcionam fora da Claude**. Eles usam uma função de armazenamento (`window.storage`) que só existe dentro do ambiente de artifacts da Claude — não é um recurso de navegador nem de HTML puro.

Se você abrir esse `index.html` direto no navegador, ou hospedar ele no GitHub Pages, Netlify, etc., **tudo o resto da página funciona normalmente** (catálogo, grade de medidas, o formulário até deixa preencher e "enviar"), só que:
- o pedido não vai ser salvo em lugar nenhum de verdade;
- a lista de pedidos e o painel admin vão ficar sempre vazios/quebrados.

Procure no arquivo por `window.storage` (aparece em poucos lugares, dentro da tag `<script>` no final do arquivo) — são os pontos que precisam ser trocados por uma chamada a um banco de dados de verdade (Google Sheets + Apps Script, Supabase, Firebase, etc.) pra funcionar fora da Claude. Se quiser, posso te ajudar a montar essa parte quando for a hora — é um serviço separado e gratuito, só precisa de um pouco de configuração.

## Estrutura da página (`index.html`)

- CSS no `<head>`, dentro de `<style>`.
- HTML do conteúdo (hero, sobre, catálogo, medidas, formulário, lista, admin) no `<body>`.
- JS no final do arquivo, dentro de `<script>`, tudo dentro de uma única IIFE `(function(){ ... })();`.

Pontos fixos que talvez você queira revisar/trocar:
- Chave Pix: `alexvafmadruga@gmail.com`
- WhatsApp da assessoria: `+55 48 9131-1234`
- Login do admin: usuário `madruga`, senha `Ultra5*` (constantes `ADMIN_USER` / `ADMIN_PASS` no JS — **atenção:** hoje isso é só uma trava simples do lado do cliente, não é segurança de verdade; qualquer pessoa que abrir o código-fonte da página vê a senha).
