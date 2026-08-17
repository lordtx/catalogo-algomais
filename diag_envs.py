#!/usr/bin/env python3
"""Extrai envs do app Canivete e mostra apenas keys + valor truncado."""
import json, urllib.request, urllib.error

TOKEN = open("/home/hermeswebui/.cf_token").read().strip()
BASE = "https://server.dtxnet.top/api/v1"

def api(method, path):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 Chrome/126.0")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]

FILTRO = ("DATABASE_URL", "S3_", "NTFY_", "SENHA_ADM", "PAINEL_ADM")
s, d = api("GET", "/applications/4kr6vs7pobyoupzvyhu4z1b0/envs")
print("status:", s)
if s == 200:
    for e in d:
        k = e.get("key", "")
        if any(f in k for f in FILTRO):
            v = e.get("real_value") or e.get("value") or ""
            print(k, "=>", v[:90] + ("..." if len(v) > 90 else ""))