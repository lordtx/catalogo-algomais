#!/usr/bin/env python3
"""Cria os registros DNS do Catálogo Algo+ no Cloudflare (zona algomais.shop).
Registros: catalogo (vitrine) e catadm (admin) → 187.127.48.130
Requisito: domínio algomais.shop registrado e zona no Cloudflare;
token CF com Zone > DNS > Edit (/home/hermeswebui/.cf_api_token)
"""
import json, os, socket, time
import urllib.request, urllib.error

def req(url, token, method="GET", body=None):
    r = urllib.request.Request(url, method=method)
    r.add_header("Authorization", "Bearer " + token)
    r.add_header("User-Agent", "Mozilla/5.0 Chrome/126.0")
    r.add_header("Accept", "application/json")
    if body is not None:
        r.add_header("Content-Type", "application/json")
        r.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw.decode(errors="replace")[:300]}

CF = open("/home/hermeswebui/.cf_api_token").read().strip()
IP = "187.127.48.130"
ZONA_NOME = "algomais.shop"
SUBDOMINIOS = [
    (os.environ.get("DOMINIO_VITRINE", "catalogo.algomais.shop"), "Catálogo Algo+ — vitrine"),
    (os.environ.get("PAINEL_ADM_HOSTS", "catadm.algomais.shop"), "Catálogo Algo+ — painel admin"),
]

# 1. descobre a zona algomais.shop
s, d = req(f"https://api.cloudflare.com/client/v4/zones?name={ZONA_NOME}", CF)
if not d.get("success") or not d.get("result"):
    print("ERRO: zona", ZONA_NOME, "não encontrada no Cloudflare.")
    print("  → O domínio precisa estar registrado e adicionado ao Cloudflare antes.")
    print("  Detalhe:", json.dumps(d)[:300])
    raise SystemExit(1)
zone_id = d["result"][0]["id"]
print("✔ Zona:", ZONA_NOME, zone_id)

for nome, comentario in SUBDOMINIOS:
    if not nome or "." not in nome:
        continue
    s, d = req(f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records?name={nome}", CF)
    existente = d.get("result", []) if d.get("success") else []
    if existente:
        rec = existente[0]
        print("Já existe:", rec["type"], rec["name"], "->", rec["content"], "| proxied:", rec.get("proxied"))
        continue
    body = {"type": "A", "name": nome.split(".")[0], "content": IP, "ttl": 1, "proxied": False,
            "comment": comentario}
    s2, d2 = req(f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records", CF, "POST", body)
    if d2.get("success"):
        print("✅ Registro criado:", d2["result"]["type"], d2["result"]["name"], "->", d2["result"]["content"])
    else:
        print("ERRO ao criar", nome, ":", json.dumps(d2)[:300])
        raise SystemExit(1)

# 2. confirma propagação (pode falhar até o domínio resolver globalmente)
time.sleep(3)
for nome, _ in SUBDOMINIOS:
    try:
        ips = socket.gethostbyname_ex(nome)[2]
        print("Resolução", nome, ":", ips)
    except Exception as e:
        print("Resolução pendente para", nome, ":", e)