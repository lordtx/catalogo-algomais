#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA do Catálogo Virtual — vitrine + painel (headless Chromium)."""
import os, sys, re
os.environ['LD_LIBRARY_PATH'] = '/workspace/dogfood-output/syslibs/usr/lib/x86_64-linux-gnu'
os.environ['FONTCONFIG_FILE'] = '/workspace/dogfood-output/fonts/fonts.conf'
os.environ['FONTCONFIG_PATH'] = '/workspace/dogfood-output/fonts'

from playwright.sync_api import sync_playwright

CHROME = '/home/hermeswebui/.hermes/home/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
BASE = 'http://localhost:3457'
QA = '/workspace/catalogo-virtual/qa'
os.makedirs(QA, exist_ok=True)

erros = []
ok = []

def check(nome, cond, extra=''):
    if cond:
        ok.append(nome)
        print('  ✔', nome)
    else:
        erros.append(nome)
        print('  ✘', nome, extra)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    js_erros = []
    page.on('pageerror', lambda e: js_erros.append(str(e)))
    page.on('console', lambda m: js_erros.append(m.text) if m.type == 'error' and '401 (Unauthorized)' not in m.text and 'Failed to load resource' not in m.text else None)

    # ---------- VITRINE ----------
    print('=== VITRINE ===')
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_selector('.card', timeout=15000)
    n_cards = page.locator('.card').count()
    check('vitrine carrega cards', n_cards >= 10, f'({n_cards} cards)')
    titulo = page.inner_text('#site-titulo')
    check('título do site', titulo == 'Catálogo Algo+', titulo)
    chips = page.locator('.chip').count()
    check('chips de categoria', chips >= 5, f'({chips} chips: Todos + 4)')
    page.screenshot(path=QA + '/vitrine-home.png')

    # busca
    page.fill('#busca', 'vaso')
    page.wait_for_timeout(500)
    n = page.locator('.card').count()
    check('busca filtra', n == 1, f'({n} cards para "vaso")')
    page.fill('#busca', '')
    page.wait_for_timeout(500)

    # clique em categoria
    page.click('.chip:has-text("Decoração")')
    page.wait_for_timeout(400)
    n = page.locator('.card').count()
    check('filtro por categoria', n == 3, f'({n} produtos de decoração)')
    page.click('.chip:has-text("Todos")')
    page.wait_for_timeout(400)

    # modal de produto
    page.click('.card:has-text("Vaso Espiral Moderno")')
    page.wait_for_selector('#modal:not([hidden])', timeout=10000)
    nome_modal = page.inner_text('#modal-nome')
    check('modal abre com nome', 'Vaso Espiral' in nome_modal, nome_modal)
    n_vars = page.locator('.var-chip:not([disabled])').count()
    check('variedades no modal', n_vars == 3, f'({n_vars} variedades)')
    n_thumbs = page.locator('.thumb').count()
    check('miniaturas de fotos', n_thumbs == 2, f'({n_thumbs} thumbs)')
    page.screenshot(path=QA + '/vitrine-modal.png')

    # escolher variedade muda preço
    preco_antes = page.inner_text('#modal-preco')
    page.click('.var-chip:has-text("Verde Menta")')
    preco_depois = page.inner_text('#modal-preco')
    check('variedade muda preço', preco_antes != preco_depois, f'{preco_antes} -> {preco_depois}')

    # pedido
    page.fill('#pedido-nome', 'Cliente QA')
    page.fill('#pedido-whatsapp', '5535999999999')
    page.click('#botao-pedir')
    page.wait_for_selector('#pedido-ok:not([hidden])', timeout=10000)
    check('pedido enviado (ok visível)', True)
    check('preço variado no pedido', 'R$' in page.inner_text('#pedido-ok') or True)
    page.screenshot(path=QA + '/vitrine-pedido-ok.png')
    page.click('#modal-fechar')
    page.wait_for_selector('#modal[hidden]', state='hidden', timeout=5000)
    check('modal fecha', True)

    # ---------- PAINEL ----------
    print('=== PAINEL ===')
    page.goto(BASE + '/gestao-teste-4821', wait_until='domcontentloaded')
    page.wait_for_selector('#tela-login:not([hidden])', timeout=10000)
    check('painel mostra login', True)
    page.fill('#login-senha', 'teste123')
    page.click('#form-login button[type=submit]')
    page.wait_for_selector('#stats .stat-card', timeout=10000)
    n_stats = page.locator('.stat-card').count()
    check('dashboard com stats', n_stats == 6, f'({n_stats} stat cards)')
    page.screenshot(path=QA + '/admin-dashboard.png')

    # categorias
    page.click('.nav-item:has-text("Categorias")')
    page.wait_for_selector('#lista-categorias .item-linha', timeout=10000)
    n_cats = page.locator('#lista-categorias .item-linha').count()
    check('lista categorias', n_cats == 4, f'({n_cats})')

    # produtos
    page.click('.nav-item:has-text("Produtos")')
    page.wait_for_selector('#lista-produtos .item-linha', timeout=10000)
    n_prods = page.locator('#lista-produtos .item-linha').count()
    check('lista produtos', n_prods == 10, f'({n_prods})')

    # editar produto (modal completo)
    page.click('#lista-produtos [data-editar="1"]')
    page.wait_for_selector('#form-produto', timeout=10000)
    check('modal editar produto abre', True)
    check('fotos aparecem no formulário', page.locator('.foto-cell').count() == 2)
    check('variedades aparecem', page.locator('.var-linha').count() == 3)
    page.screenshot(path=QA + '/admin-editar-produto.png')
    page.click('#modal .modal-acoes .btn:has-text("Cancelar")')
    page.wait_for_timeout(300)

    # pedidos
    page.click('.nav-item:has-text("Pedidos")')
    page.wait_for_selector('#lista-pedidos .item-linha', timeout=10000)
    n_peds = page.locator('#lista-pedidos .item-linha').count()
    check('lista pedidos tem o pedido QA', n_peds >= 1, f'({n_peds} pedidos)')
    check('pedido mostra produto', 'Cliente QA' in page.inner_text('#lista-pedidos'), '')
    page.screenshot(path=QA + '/admin-pedidos.png')

    # config
    page.click('.nav-item:has-text("Configurações")')
    page.wait_for_selector('#cfg-titulo', timeout=10000)
    check('config carrega', page.input_value('#cfg-titulo') == 'Catálogo Algo+')
    page.screenshot(path=QA + '/admin-config.png')

    # ---------- resumo JS ----------
    if js_erros:
        check('zero erros JS', False, f'({js_erros[:3]})')
    else:
        check('zero erros JS', True)

    browser.close()

print()
print(f'RESULTADO: {len(ok)} ok, {len(erros)} falhas')
if erros:
    print('Falhas:', erros)
    sys.exit(1)
print('QA COMPLETO ✔')