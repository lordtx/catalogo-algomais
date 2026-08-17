#!/usr/bin/env python3
"""Gera o arquivo .env-deploy (gitignored) do Catálogo Algo+ com recursos SEPARADOS:
   - Postgres: mesma credencial do Canivete, banco catalogo_algomais
   - MinIO:    mesma credencial do Canivete, bucket catalogo-algomais
Lê as credenciais reais de /tmp/canivete_envs.json (extraídas do app Canivete no Coolify).
"""
import json, sys, os

try:
    envs = json.load(open("/tmp/canivete_envs.json"))
except Exception as e:
    print("ERRO: rode primeiro pegar_envs_canivete.py —", e)
    sys.exit(1)

# --- Postgres: troca só o banco ---
db_url = envs.get("DATABASE_URL", "")
if not db_url:
    print("ERRO: DATABASE_URL do Canivete vazia"); sys.exit(1)
url = db_url
# substitui o último segmento do path pelo banco novo
if "/" in url.split("//", 1)[1]:
    base, _, _db = url.rpartition("/")
    db_url_novo = base + "/catalogo_algomais"
else:
    db_url_novo = url + "/catalogo_algomais"

# --- MinIO: mesmo endpoint/credenciais, bucket separado ---
s3_endpoint = envs.get("S3_ENDPOINT", "")
s3_key = envs.get("S3_ACCESS_KEY", "")
s3_secret = envs.get("S3_SECRET_KEY", "")
s3_region = envs.get("S3_REGION", "us-east-1")

with open("/workspace/catalogo-virtual/.env-deploy", "w") as f:
    # aspas simples: valores com #, &, $ etc. sobrevivem ao `source` no shell
    f.write(f"DATABASE_URL='{db_url_novo}'\n")
    f.write(f"S3_ENDPOINT='{s3_endpoint}'\n")
    f.write("S3_BUCKET='catalogo-algomais'\n")
    f.write(f"S3_ACCESS_KEY='{s3_key}'\n")
    f.write(f"S3_SECRET_KEY='{s3_secret}'\n")
    f.write(f"S3_REGION='{s3_region}'\n")

print("✔ .env-deploy gerado:")
print("  DATABASE_URL: .../catalogo_algomais (banco separado)")
print(f"  S3_BUCKET: catalogo-algomais (bucket separado)")
print(f"  S3_ENDPOINT: {s3_endpoint}")