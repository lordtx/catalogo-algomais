#!/usr/bin/env python3
"""Cria o projeto/app do Catálogo Algo+ no Coolify via API.
Lê env: PAINEL_ADM, SENHA_ADM, PAINEL_ADM_HOSTS, DOMINIO_VITRINE, CONTATO_WHATSAPP, NTFY_*
"""
import json, os, sys
import urllib.request, urllib.error

TOKEN = open("/home/hermeswebui/.cf_token").read().strip()
BASE = "https://server.dtxnet.top/api/v1"
SERVER = "9xu3hjh5bt7qerpukkbcwkej"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")
    req.add_header("Accept", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw.decode(errors="replace")[:400]}

# ---- 1. projeto "AlgoMais" (reutiliza se existir)
s, d = api("GET", "/projects")
proj = None
if s == 200:
    for p in d:
        if p.get("name") == "AlgoMais":
            proj = p
            break
if proj:
    print("✔ Projeto AlgoMais já existe:", proj["uuid"])
    proj_uuid = proj["uuid"]
else:
    s, d = api("POST", "/projects", {"name": "AlgoMais", "description": "AlgoMais - impressao 3D e catalogo"})
    if s not in (200, 201):
        print("ERRO ao criar projeto:", json.dumps(d)[:400]); sys.exit(1)
    proj_uuid = d.get("uuid")
    print("✔ Projeto AlgoMais criado:", proj_uuid)

# ---- 2. aplicação (reutiliza se existir)
s, d = api("GET", "/applications")
app = None
if s == 200:
    for a in d:
        if a.get("name") == "CatalogoAlgoMais":
            app = a
            break

envs = [
    {"key": "PAINEL_ADM", "value": os.environ["PAINEL_ADM"]},
    {"key": "SENHA_ADM", "value": os.environ["SENHA_ADM"]},
    {"key": "PAINEL_ADM_HOSTS", "value": os.environ.get("PAINEL_ADM_HOSTS", "catadm.algomais.shop")},
    {"key": "DATA_DIR", "value": "/data"},
    {"key": "SITE_TITULO", "value": "Catálogo Algo+"},
    {"key": "SITE_DESCRICAO", "value": "Impressão 3D sob medida: decoração, personalizados e utilidades."},
]
if os.environ.get("CONTATO_WHATSAPP"):
    envs.append({"key": "CONTATO_WHATSAPP", "value": os.environ["CONTATO_WHATSAPP"]})
# opcionais: banco Postgres e storage S3 (adicionados quando definidos)
for k in ("DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_REGION"):
    if os.environ.get(k):
        envs.append({"key": k, "value": os.environ[k]})
for k in ("NTFY_URL", "NTFY_TOPIC", "NTFY_TOKEN"):
    if os.environ.get(k):
        envs.append({"key": k, "value": os.environ[k]})

fqdn = "https://" + os.environ.get("DOMINIO_VITRINE", "catalogo.algomais.shop") + ",https://" + os.environ.get("PAINEL_ADM_HOSTS", "catadm.algomais.shop")

payload = {
    "project_uuid": proj_uuid,
    "server_uuid": SERVER,
    "environment_name": "production",
    "git_repository": "lordtx/catalogo-algomais",
    "git_branch": "main",
    "build_pack": "dockerfile",
    "ports_exposes": "3000",
    "fqdn": fqdn,
    "name": "CatalogoAlgoMais",
    "description": "Catálogo Algo+ — vitrine de impressão 3D com painel admin (Node+Express)",
    "environment_variables": envs,
    "persistent_storages": [
        {"name": "catalogo-algomais-data", "mount_path": "/data", "size": 1}
    ],
}

if app:
    app_uuid = app["uuid"]
    print("✔ App CatalogoAlgoMais já existe:", app_uuid, "— atualizando env/domínios")
    s, d = api("PATCH", f"/applications/{app_uuid}", {
        "fqdn": fqdn,
        "environment_variables": envs,
        "persistent_storages": [{"name": "catalogo-algomais-data", "mount_path": "/data", "size": 1}],
    })
    print("  PATCH ->", s, json.dumps(d)[:200] if s != 200 else "ok")
else:
    s, d = api("POST", "/applications", payload)
    if s not in (200, 201):
        print("ERRO ao criar aplicação:", json.dumps(d)[:600])
        print("\n→ Crie manualmente pela UI e rode: POST /applications/.../deploy")
        sys.exit(1)
    app_uuid = d.get("uuid")
    print("✔ Aplicação CatalogoAlgoMais criada:", app_uuid)

# ---- 3. deploy
print("▶ Disparando deploy...")
s, d = api("POST", f"/applications/{app_uuid}/deploy", {})
print("  deploy ->", s, json.dumps(d)[:200] if s != 200 else "ok")
print("\n✔ Acompanhe o build no painel do Coolify.")