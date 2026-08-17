#!/usr/bin/env bash
# ============================================================
# DEPLOY DO CATÁLOGO Algo+ — repo GitHub + app Coolify + DNS
#
# Uso:
#   GH_TOKEN=... PAINEL_ADM=... SENHA_ADM=... bash deploy.sh
#
# Env obrigatórias:
#   GH_TOKEN      token GitHub (fine-grained, repo create + push)
#   PAINEL_ADM    caminho reserva do painel (ex: gestao-algo-7391)
#   SENHA_ADM     senha inicial do admin (trocável depois pelo painel)
#
# Env opcionais:
#   DOMINIO_VITRINE       domínio da vitrine (padrão: catalogo.algomais.shop)
#   PAINEL_ADM_HOSTS      domínio do painel admin (padrão: catadm.algomais.shop)
#   CONTATO_WHATSAPP      WhatsApp da loja (só números, com DDI)
#   NTFY_URL / NTFY_TOPIC / NTFY_TOKEN
#   DATABASE_URL / S3_*   Postgres + MinIO (padrão: SQLite + disco)
#   DATA_DIR              (padrão /data — volume persistente)
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
GH_TOKEN="${GH_TOKEN:-$(cat "${DIR}/.git-token" 2>/dev/null | tr -d '[:space:]')}"
if [ -z "$GH_TOKEN" ]; then echo "❌ Defina GH_TOKEN (ou crie .git-token)"; exit 1; fi
PAINEL_ADM="${PAINEL_ADM:?Defina PAINEL_ADM (caminho reserva do painel)}"
SENHA_ADM="${SENHA_ADM:?Defina SENHA_ADM}"
DOMINIO_VITRINE="${DOMINIO_VITRINE:-catalogo.algomais.shop}"
PAINEL_ADM_HOSTS="${PAINEL_ADM_HOSTS:-catadm.algomais.shop}"
CONTATO_WHATSAPP="${CONTATO_WHATSAPP:-}"
REPO="lordtx/catalogo-algomais"

echo "============================================================"
echo " CATÁLOGO Algo+ — deploy"
echo "  Vitrine: https://${DOMINIO_VITRINE}"
echo "  Admin:   https://${PAINEL_ADM_HOSTS}  (reserva: /${PAINEL_ADM})"
echo "  WhatsApp: ${CONTATO_WHATSAPP:-não definido (configurável no painel)}"
echo "============================================================"

# ---------- 1. Repositório GitHub ----------
echo "▶ 1/4 Criando repositório $REPO ..."
curl -s -X POST "https://api.github.com/user/repos" \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: deploy-catalogo-algo" \
  -d "{\"name\":\"catalogo-algomais\",\"description\":\"Catálogo Algo+ — vitrine de impressão 3D com painel admin (Node+Express)\",\"private\":false}" \
  -o /tmp/gh_catalogo.json -w "  HTTP %{http_code}\n" || true
if ! grep -q '"full_name"' /tmp/gh_catalogo.json; then
  echo "  (repo pode já existir — seguindo)"
fi

echo "▶ Enviando código..."
cd "$DIR"
git init -q 2>/dev/null || true
git add -A
git commit -qm "Catálogo Algo+: vitrine de impressão 3D com painel admin" 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "https://lordtx:${GH_TOKEN}@github.com/${REPO}.git"
git push -u origin main -f 2>&1 | tail -2

# ---------- 2. App no Coolify ----------
echo "▶ 2/4 Criando/atualizando aplicação no Coolify..."
# carrega .env-deploy (DATABASE_URL, S3_*, NTFY_*) se existir
if [ -f "${DIR}/.env-deploy" ]; then
  set -a; source "${DIR}/.env-deploy"; set +a
  echo "  ✔ .env-deploy carregado (banco + storage S3)"
fi
export PAINEL_ADM SENHA_ADM PAINEL_ADM_HOSTS DOMINIO_VITRINE CONTATO_WHATSAPP DATA_DIR
export DATABASE_URL S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY S3_REGION NTFY_URL NTFY_TOPIC NTFY_TOKEN
python3 "${DIR}/criar_app_coolify.py"

# ---------- 3. DNS ----------
echo "▶ 3/4 Criando registros DNS..."
export DOMINIO_VITRINE PAINEL_ADM_HOSTS
python3 "${DIR}/criar_dns.py" || echo "  ⚠ DNS não criado — o domínio algomais.shop precisa existir no Cloudflare. Crie os registros A ou rode este passo depois."

# ---------- 4. Pronto ----------
echo ""
echo "============================================================"
echo " AGORA NO PAINEL DO COOLIFY (https://server.dtxnet.top):"
echo "============================================================"
echo " ✔ Repo:  ${REPO} (público — a API Coolify não associa GitHub App)"
echo " ✔ App:   CatalogoAlgoMais (dockerfile, porta 3000)"
echo " ✔ Domínios: ${DOMINIO_VITRINE} + ${PAINEL_ADM_HOSTS}"
echo " ✔ Volume: /data (persistente)"
echo ""
echo " Se o deploy não disparou sozinho, clique em Redeploy no app."
echo " Env vars já injetadas: PAINEL_ADM, SENHA_ADM, PAINEL_ADM_HOSTS,"
echo "   CONTATO_WHATSAPP, DATA_DIR, NTFY_* (se definidas)"
echo ""
echo " Depois de publicado (domínio ativo):"
echo "   Vitrine → https://${DOMINIO_VITRINE}"
echo "   Admin   → https://${PAINEL_ADM_HOSTS} (senha: SENHA_ADM)"
echo "============================================================"