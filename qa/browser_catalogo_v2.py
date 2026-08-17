#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA do Catálogo Algo+ v2 — vitrine multi-itens (carrinho un./dezena) + painel (headless Chromium)."""
import os, sys
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
    check('título do site', page.inner_text('#site-titulo') == 'Catálogo Algo+')
    check('chips de categoria', page.locator('.chip').count() >= 5)
    page.screenshot(path=QA + '/v2-vitrine-home.png')

    # busca
    page.fill('#busca', 'vaso')
    page.wait_for_timeout(500)
    check('busca filtra', page.locator('.card').count() == 1, f'({page.locator(".card").count()} cards)')
    page.fill('#busca', '')
    page.wait_for_timeout(500)

    # modal: variedade + unidade dezena + adicionar
    page.click('.card:has-text("Vaso Espiral")')
    page.wait_for_selector('#modal:not([hidden])', timeout=10000)
    check('modal abre', 'Vaso Espiral' in page.inner_text('#modal-nome'))
    check('seletor de unidade presente', page.locator('#unidade-seletor').count() == 1)
    check('botão adicionar ao pedido', page.locator('#btn-add-carrinho').count() == 1)
    # escolhe dezena
    page.select_option('#unidade-seletor', 'dz')
    # quantidade 2
    page.click('#qtd-mais')
    page.wait_for_timeout(150)
    check('qtd=2', page.inner_text('#qtd-valor') == '2')
    page.click('#btn-add-carrinho')
    page.wait_for_selector('#modal[hidden]', state='hidden', timeout=5000)
    check('carrinho badge', not page.locator('#carrinho-badge').evaluate("el => el.hidden"))
    page.screenshot(path=QA + '/v2-carrinho-1.png')

    # adiciona 2º produto (unidade)
    page.click('.card:has-text("Caneca")')
    page.wait_for_selector('#modal:not([hidden])', timeout=10000)
    page.select_option('#unidade-seletor', 'un')
    page.click('#btn-add-carrinho')
    page.wait_for_selector('#modal[hidden]', state='hidden', timeout=5000)
    check('badge 2 itens', page.inner_text('#carrinho-badge') == '2', page.inner_text('#carrinho-badge'))

    # abre o carrinho
    page.click('#carrinho-toggle')
    page.wait_for_selector('#carrinho-painel.aberto', timeout=5000)
    check('painel carrinho abre', True)
    check('2 itens no carrinho', page.locator('.carrinho-item').count() == 2)
    check('mostra unidade dz', 'Dezena' in page.inner_text('#carrinho'))
    page.screenshot(path=QA + '/v2-carrinho-aberto.png')

    # finalizar
    page.click('#btn-finalizar')
    page.wait_for_selector('#modal-finalizar:not([hidden])', timeout=5000)
    check('modal finalizar abre', True)
    check('itens listados na finalização', page.locator('.fin-item').count() == 2)
    page.fill('#finalizar-nome', 'Cliente QA 2')
    page.fill('#finalizar-whatsapp', '5535999999999')
    page.click('#finalizar-botao')
    page.wait_for_selector('#finalizar-ok:not([hidden])', timeout=12000)
    check('pedido enviado', 'Pedido #' in page.inner_text('#finalizar-ok'))
    check('PDF link aparece', page.locator('#finalizar-pdf a').count() == 1)
    check('WhatsApp link aparece', page.locator('#finalizar-wa a').count() == 1)
    wa_href = page.get_attribute('#finalizar-wa a', 'href') or ''
    check('WhatsApp com número da loja', '5535920007413' in wa_href, wa_href[:60])
    pdf_href = page.get_attribute('#finalizar-pdf a', 'href') or ''
    check('PDF link válido', pdf_href.startswith('/arquivos/'), pdf_href)
    page.screenshot(path=QA + '/v2-finalizado.png')

    # ---------- PAINEL ----------
    print('=== PAINEL ===')
    page.goto(BASE + '/gestao-teste-4821', wait_until='domcontentloaded')
    page.wait_for_selector('#tela-login:not([hidden])', timeout=10000)
    page.fill('#login-senha', 'teste123')
    page.click('#form-login button[type=submit]')
    page.wait_for_selector('#stats .stat-card', timeout=10000)
    check('dashboard com stats', page.locator('.stat-card').count() == 6)

    page.click('.nav-item:has-text("Pedidos")')
    page.wait_for_selector('#lista-pedidos .item-linha', timeout=10000)
    n_peds = page.locator('#lista-pedidos .item-linha').count()
    check('pedidos listados', n_peds >= 2, f'({n_peds})')
    check('itens mostrados no pedido', page.locator('.ped-item').count() >= 2)
    check('link PDF no pedido', page.locator('.link-pdf').count() >= 1)
    page.screenshot(path=QA + '/v2-admin-pedidos.png')

    # config mostra whatsapp
    page.click('.nav-item:has-text("Configurações")')
    page.wait_for_selector('#cfg-whatsapp', timeout=10000)
    check('whatsapp salvo na config', page.input_value('#cfg-whatsapp') == '5535920007413')

    if js_erros:
        check('zero erros JS', False, f'({js_erros[:4]})')
    else:
        check('zero erros JS', True)

    browser.close()

print()
print(f'RESULTADO: {len(ok)} ok, {len(erros)} falhas')
if erros:
    print('Falhas:', erros)
    sys.exit(1)
print('QA v2 COMPLETO ✔')