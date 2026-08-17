# Catálogo Algo+ 🧊

Vitrine de produtos de **impressão 3D** com painel administrativo — cadastre categorias,
produtos, fotos e variedades (cores, tamanhos, materiais), e o cliente navega pela vitrine
e pede pelo WhatsApp. Mesmo esqueleto do [Canivete](../canivete-dtxnet): banco dual
(PostgreSQL/SQLite), arquivos dual (MinIO/S3/disco), painel em domínio dedicado,
PWA e deploy via Docker → Coolify.

- **Vitrine:** https://catalogo.algomais.shop
- **Admin:** https://catadm.algomais.shop (domínio dedicado) ou `/{PAINEL_ADM}` (caminho reserva)

## Stack

- Node.js 22 + Express — serviço único
- **Banco selecionável por env var**: PostgreSQL (`DATABASE_URL`, driver `pg`) **ou** SQLite (`better-sqlite3`, padrão)
- **Arquivos selecionáveis por env var**: MinIO/S3 (`S3_*`, SDK `@aws-sdk/client-s3`) **ou** disco local (padrão)
- Frontend vanilla JS (sem build), PWA (manifest + service worker)
- Deploy: Dockerfile → Coolify (volume persistente `/data`)

## Modelo de dados

```
categorias ──< produtos ──< fotos
                  └──────< variedades (nome, preço próprio, estoque)
pedidos: produto + variedade + nome/whatsapp/qtd/obs → ntfy pro admin
```

## Variáveis de ambiente (Coolify → Environment Variables)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PAINEL_ADM` | ✅ | Caminho reserva do painel (ex: `gestao-algo-7391`) |
| `SENHA_ADM` | ✅ | Senha inicial do admin (trocável pelo painel; depois vale o banco) |
| `PAINEL_ADM_HOSTS` | — | Domínio do painel (padrão: `catadm.algomais.shop`) |
| `DOMINIO_VITRINE` | — | Domínio da vitrine (padrão: `catalogo.algomais.shop`) — usado pelos scripts de deploy |
| `CONTATO_WHATSAPP` | — | WhatsApp da loja (só números, com DDI — ex: `5535999999999`). Configurável no painel |
| `DATABASE_URL` | — | Connection string PostgreSQL. Sem ela usa SQLite |
| `S3_ENDPOINT` | — | Endpoint do MinIO/S3 (ex: `http://minio:9000`). Sem ele usa disco local |
| `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | — | Bucket e credenciais S3 (obrigatórias junto com S3_ENDPOINT) |
| `PEDIDO_PERSONALIZADO` | — | `1` (padrão: cliente informa nome/WhatsApp antes do envio) ou `0` (só botão direto) |
| `NTFY_URL` / `NTFY_TOPIC` / `NTFY_TOKEN` | — | Notificações de pedidos (opcional) |
| `DATA_DIR` | — | Pasta de dados (padrão `/data` — **use volume persistente!**) |
| `PORT` | — | Porta (padrão 3000) |
| `SITE_TITULO` / `SITE_DESCRICAO` / `TEMA` / `FUNDO_*` / `CONTATO_EMAIL` / `NOTA_RODAPE` | — | Defaults iniciais (configuráveis pelo painel) |

## Deploy

```bash
GH_TOKEN=*** PAINEL_ADM=gestao-algo-7391 SENHA_ADM=minha-senha \
  CONTATO_WHATSAPP=5535999999999 bash deploy.sh
```

O script faz 4 passos: (1) cria o repo `lordtx/catalogo-algomais` (**público** — a API
Coolify não associa GitHub App e o clone via https exige repo público), (2) cria/atualiza
o app `CatalogoAlgoMais` no Coolify (projeto `AlgoMais`, dockerfile, porta 3000,
volume `/data`, domínios), (3) cria os registros DNS no Cloudflare (`catalogo` +
`catadm` → IP da VPS), (4) dispara o deploy.

> O passo de DNS exige que o domínio `algomais.shop` já esteja **registrado** e com zona
> no Cloudflare. Se ainda não estiver, rode o script de novo depois (ele é idempotente).

## Testes locais

```bash
npm install
# SQLite + disco (padrão)
PAINEL_ADM=gestao-teste SENHA_ADM=teste123 PAINEL_ADM_HOSTS=catadm.algomais.shop \
  DATA_DIR=./dados PORT=3457 node server.js
```

## Fluxo do cliente

1. Abre a vitrine, navega por categorias ou busca
2. Clica num produto → modal com galeria de fotos e variedades (com preço/estoque)
3. Escolhe quantidade → preenche nome/WhatsApp → **Pedir pelo WhatsApp**
   - Entra pedido no banco + notificação ntfy pro admin; se houver `CONTATO_WHATSAPP`,
     abre o WhatsApp com a mensagem montada

## Fluxo do admin

1. `https://catadm.algomais.shop` (ou `/{PAINEL_ADM}`) → login com senha
2. **Categorias** → nome, ícone (emoji), ordem, ativa
3. **Produtos** → categoria, nome, descrição, preço base, destaque, ordem;
   fotos (múltiplas, escolhe capa) e variedades (nome, preço próprio, estoque)
4. **Pedidos** → todos os pedidos dos clientes, com filtro por status (novo/visto/atendido/cancelado)
5. **Configurações** → título, tema, WhatsApp/email de contato, senha