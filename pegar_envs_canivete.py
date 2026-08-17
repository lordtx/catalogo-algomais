#!/usr/bin/env python3
"""Extrai envs do app Canivete no Coolify e cria banco/bucket separados do catalogo."""
import json, os, sys, subprocess
import urllib.request, urllib.error

TOKEN = open("/home/hermeswebui/.cf_token").read().strip()
BASE = "https://server.dtxnet.top/api/v1"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 Chrome/126.0")
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

# 1. envs do Canivete
s, d = api("GET", "/applications/4kr6vs7pobyoupzvyhu4z1b0/envs")
if s != 200:
    print("ERRO envs canivete:", s, json.dumps(d)[:300]); sys.exit(1)
envs = {e["key"]: e.get("real_value", e.get("value", "")) for e in d}
keys_interesse = ["DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_REGION", "NTFY_URL", "NTFY_TOPIC", "NTFY_TOKEN", "CONTATO_WHATSAPP"]
for k in keys_interesse:
    v = envs.get(k, "")
    if v:
        print(f"  {k}: {'***' + v[-6:] if len(v) > 12 else '***'}")
    else:
        print(f"  {k}: (vazio)")

with open("/tmp/canivete_envs.json", "w") as f:
    json.dump(envs, f)
print("✔ envs salvas em /tmp/canivete_envs.json")
