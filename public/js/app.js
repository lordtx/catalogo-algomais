'use strict';
/* ============================================================
   CATÁLOGO VIRTUAL — vitrine do cliente
   Carrinho multi-itens: cada item com unidade (un./dezena) e quantidade.
   ============================================================ */
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  let SITE = null;
  let CATALOGO = [];
  let catAtiva = 'todos';
  let busca = '';
  let produtoAtual = null;   // produto aberto no modal
  let variedadeAtual = null;
  let qtd = 1;
  let unidadeAtual = 'un';   // un | dz
  let imgAtual = 0;
  let carrinho = [];         // {produto_id, variedade_id, nome, variedade_nome, unidade, quantidade, preco_unitario}

  const dispositivo = (() => {
    try {
      let d = localStorage.getItem('ctl_dispositivo');
      if (!d) { d = 'disp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('ctl_dispositivo', d); }
      return d;
    } catch { return 'disp-' + Math.random().toString(36).slice(2, 10); }
  })();

  /* ---- formatação ---- */
  const fmtBR = n => (n == null ? '' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

  const precoDe = (prod) => {
    if (prod.variedades && prod.variedades.length) {
      const precos = prod.variedades.map(v => v.preco == null ? prod.preco : v.preco).filter(p => p != null && p > 0);
      if (precos.length) return { valor: Math.min(...precos), aPartir: true };
    }
    return { valor: prod.preco, aPartir: false };
  };

  /* ---- carrinho (localStorage) ---- */
  function carregarCarrinho() {
    try { carrinho = JSON.parse(localStorage.getItem('ctl_carrinho') || '[]'); } catch { carrinho = []; }
    renderCarrinho();
  }
  function salvarCarrinho() {
    try { localStorage.setItem('ctl_carrinho', JSON.stringify(carrinho)); } catch {}
    renderCarrinho();
  }
  function totalCarrinho() {
    return carrinho.reduce((a, it) => a + Number(it.preco_unitario) * Number(it.quantidade), 0);
  }
  function renderCarrinho() {
    const n = carrinho.length;
    const badge = $('#carrinho-badge');
    const painel = $('#carrinho');
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    if (!painel) return;
    if (!n) { painel.innerHTML = '<p class="carrinho-vazio">Seu pedido está vazio.<br>Navegue e adicione peças. 🧊</p>'; }
    else {
      painel.innerHTML = carrinho.map((it, i) => `
        <div class="carrinho-item">
          <div class="ci-info">
            <strong>${esc(it.nome)}</strong>
            ${it.variedade_nome ? `<small>${esc(it.variedade_nome)}</small>` : ''}
            <small class="ci-preco">
              ${it.unidade === 'dz' ? 'Dezena' : 'Unidade'}: ${fmtBR(it.preco_unitario)}
            </small>
          </div>
          <div class="ci-controles">
            <select class="ci-un" data-i="${i}">
              <option value="un" ${it.unidade === 'un' ? 'selected' : ''}>un.</option>
              <option value="dz" ${it.unidade === 'dz' ? 'selected' : ''}>dezena</option>
            </select>
            <span class="qtd-mini">
              <button data-menos="${i}">−</button>
              <span>${it.quantidade}</span>
              <button data-mais="${i}">+</button>
            </span>
            <button class="ci-rm" data-rm="${i}">🗑️</button>
          </div>
          <div class="ci-total">${fmtBR(Number(it.preco_unitario) * Number(it.quantidade))}</div>
        </div>`).join('');
      painel.insertAdjacentHTML('beforeend', `
        <div class="carrinho-total">Total: <strong>${fmtBR(totalCarrinho())}</strong></div>`);
      painel.insertAdjacentHTML('beforeend', `
        <button class="botao-pedir" id="btn-finalizar">🛒 Finalizar pedido</button>`);
      $$('#carrinho [data-menos]').forEach(b => b.addEventListener('click', () => {
        const it = carrinho[Number(b.dataset.menos)];
        it.quantidade = Math.max(1, it.quantidade - 1);
        salvarCarrinho();
      }));
      $$('#carrinho [data-mais]').forEach(b => b.addEventListener('click', () => {
        const it = carrinho[Number(b.dataset.mais)];
        it.quantidade = Math.min(999, it.quantidade + 1);
        salvarCarrinho();
      }));
      $$('#carrinho [data-rm]').forEach(b => b.addEventListener('click', () => {
        carrinho.splice(Number(b.dataset.rm), 1);
        salvarCarrinho();
      }));
      $$('#carrinho .ci-un').forEach(sel => sel.addEventListener('change', () => {
        const it = carrinho[Number(sel.dataset.i)];
        const novaUn = sel.value;
        const prod = CATALOGO.flatMap(c => c.produtos).find(p => p.id === it.produto_id);
        const varAtual = prod && prod.variedades ? prod.variedades.find(v => v.id === it.variedade_id) : null;
        const unit = (varAtual && varAtual.preco != null) ? varAtual.preco : (prod ? prod.preco : 0);
        it.unidade = novaUn;
        it.preco_unitario = novaUn === 'dz' ? (prod && prod.preco_dz != null && !varAtual ? prod.preco_dz : unit * 10) : unit;
        salvarCarrinho();
      }));
      $('#btn-finalizar').addEventListener('click', abrirFinalizar);
    }
  }

  /* ---- modal de finalização ---- */
  function abrirFinalizar() {
    if (!carrinho.length) return;
    const over = $('#modal-finalizar');
    $('#finalizar-itens').innerHTML = carrinho.map(it =>
      `<div class="fin-item"><span>${esc(it.nome)}${it.variedade_nome ? ' · ' + esc(it.variedade_nome) : ''}</span><span>${it.quantidade} ${it.unidade === 'dz' ? 'dz' : 'un'}</span><span>${fmtBR(Number(it.preco_unitario) * Number(it.quantidade))}</span></div>`
    ).join('');
    $('#finalizar-total').textContent = 'Total: ' + fmtBR(totalCarrinho());
    $('#finalizar-obs').value = '';
    $('#finalizar-erro').hidden = true;
    $('#finalizar-ok').hidden = true;
    $('#form-finalizar').hidden = false;
    $('#finalizar-pdf').hidden = true;
    over.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function fecharFinalizar() {
    $('#modal-finalizar').hidden = true;
    document.body.style.overflow = '';
  }

  $('#form-finalizar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = $('#finalizar-nome').value.trim();
    const whatsapp = $('#finalizar-whatsapp').value.trim();
    const observacao = $('#finalizar-obs').value.trim();
    if (!nome || !whatsapp) { $('#finalizar-erro').textContent = 'Preencha nome e WhatsApp.'; $('#finalizar-erro').hidden = false; return; }
    const botao = $('#finalizar-botao');
    botao.disabled = true;
    try {
      const r = await fetch('/api/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: carrinho.map(it => ({
            produto_id: it.produto_id,
            variedade_id: it.variedade_id || null,
            unidade: it.unidade,
            quantidade: it.quantidade,
          })),
          nome, whatsapp, observacao, dispositivo,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.erro || 'erro');
      $('#form-finalizar').hidden = true;
      const okEl = $('#finalizar-ok');
      okEl.hidden = false;
      okEl.innerHTML = `✅ Pedido #${data.id} enviado! Enviamos os detalhes para nossa equipe.`;
      if (data.pdf_url) {
        const pdfEl = $('#finalizar-pdf');
        pdfEl.hidden = false;
        pdfEl.innerHTML = `<a class="btn-pdf" href="${data.pdf_url}" target="_blank">📄 Baixar PDF do pedido</a>`;
      }
      if (data.whatsapp_url) {
        const waEl = $('#finalizar-wa');
        waEl.hidden = false;
        waEl.innerHTML = `<a class="botao-pedir" href="${data.whatsapp_url}" target="_blank" rel="noopener"><span class="wa-icone">💬</span> Chamar no WhatsApp</a>`;
      }
      carrinho = [];
      salvarCarrinho();
    } catch (err) {
      $('#finalizar-erro').textContent = 'Não foi possível enviar: ' + err.message;
      $('#finalizar-erro').hidden = false;
    } finally {
      botao.disabled = false;
    }
  });

  /* ---- aplicar tema/fundo ---- */
  function aplicarTema() {
    document.body.classList.remove('tema-claro', 'tema-escuro');
    document.body.classList.add(SITE.tema === 'escuro' ? 'tema-escuro' : 'tema-claro');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', SITE.tema === 'escuro' ? '#141419' : '#F5F1EA');
    const fundo = $('#fundo');
    if (fundo && SITE.fundo_tipo === 'cor') {
      fundo.style.background = SITE.fundo_valor || undefined;
      fundo.style.backgroundImage = 'none';
    }
  }

  /* ---- renderizar ---- */
  function renderCategorias() {
    const nav = $('#categorias');
    const chips = [{ id: 'todos', icone: '✨', nome: 'Todos' }]
      .concat(CATALOGO.map(c => ({ id: String(c.id), icone: c.icone, nome: c.nome })));
    nav.innerHTML = chips.map(c => `
      <button class="chip ${catAtiva === c.id ? 'ativo' : ''}" data-cat="${c.id}">
        <span class="icone">${c.icone}</span> ${c.nome}
      </button>`).join('');
    nav.querySelectorAll('.chip').forEach(ch =>
      ch.addEventListener('click', () => { catAtiva = ch.dataset.cat; renderCategorias(); renderGrade(); }));
  }

  function renderGrade() {
    const grade = $('#grade');
    const vazio = $('#vazio');
    let itens = [];
    for (const c of CATALOGO) {
      if (catAtiva !== 'todos' && String(c.id) !== catAtiva) continue;
      for (const p of c.produtos) itens.push({ ...p, _cat: c });
    }
    if (busca) {
      const b = busca.toLowerCase();
      itens = itens.filter(p => (p.nome + ' ' + (p.descricao || '') + ' ' + p._cat.nome).toLowerCase().includes(b));
    }
    if (!itens.length) {
      grade.innerHTML = '';
      vazio.hidden = false;
      $('#vazio-texto').textContent = busca ? 'Nenhum produto encontrado para "' + busca + '".' : 'Nenhum produto nesta categoria ainda.';
      return;
    }
    vazio.hidden = true;
    grade.innerHTML = itens.map((p, i) => {
      const foto = p.fotos && p.fotos.length ? p.fotos[0] : null;
      const pr = precoDe(p);
      const temVar = p.variedades && p.variedades.length;
      return `
      <article class="card" data-produto="${p.id}">
        ${p.destaque ? '<span class="card-badge">★ Destaque</span>' : ''}
        <div class="card-foto ${foto ? '' : 'card-sem-foto'}">
          ${foto ? `<img src="${foto}" alt="${p.nome}" loading="lazy">` : '🧊'}
        </div>
        <div class="card-corpo">
          <span class="card-categoria">${p._cat.icone} ${p._cat.nome}</span>
          <h3 class="card-nome">${p.nome}</h3>
          ${temVar ? `<span class="card-variedades">${p.variedades.length} ${p.variedades.length === 1 ? 'variação' : 'variações'}</span>` : ''}
          <div class="card-preco">${pr.aPartir ? '<small>a partir de</small> ' : ''}${fmtBR(pr.valor)}</div>
        </div>
      </article>`;
    }).join('');

    grade.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => abrirModal(Number(card.dataset.produto)));
    });
  }

  /* ---- modal ---- */
  async function abrirModal(id) {
    try {
      const r = await fetch('/api/produto/' + id);
      if (!r.ok) return;
      produtoAtual = await r.json();
    } catch { return; }
    variedadeAtual = produtoAtual.variedades && produtoAtual.variedades.length
      ? produtoAtual.variedades.find(v => v.estoque !== 0) || produtoAtual.variedades[0]
      : null;
    qtd = 1;
    unidadeAtual = 'un';
    imgAtual = 0;
    const sel = p => {
      if (p.variedades && p.variedades.length) {
        const precos = p.variedades.map(v => v.preco == null ? p.preco : v.preco).filter(x => x != null && x > 0);
        return precos.length ? { valor: Math.min(...precos), aPartir: true } : { valor: p.preco, aPartir: false };
      }
      return { valor: p.preco, aPartir: false };
    };
    const pr = sel(produtoAtual);

    $('#modal-categoria').textContent = produtoAtual.categoria ? `${produtoAtual.categoria.icone} ${produtoAtual.categoria.nome}` : '';
    $('#modal-nome').textContent = produtoAtual.nome;
    $('#modal-descricao').textContent = produtoAtual.descricao || '';
    $('#modal-descricao').hidden = !produtoAtual.descricao;
    exibirPrecoModal();

    // galeria
    const fotos = produtoAtual.fotos && produtoAtual.fotos.length ? produtoAtual.fotos : [null];
    const galeria = $('#galeria');
    galeria.hidden = !produtoAtual.fotos || !produtoAtual.fotos.length;
    if (!galeria.hidden) {
      $('#galeria-img').src = fotos[0];
      $('#galeria-img').alt = produtoAtual.nome;
      $('#galeria-thumbs').innerHTML = fotos.map((f, i) =>
        `<button class="thumb ${i === 0 ? 'ativo' : ''}" data-i="${i}">${f ? `<img src="${f}" alt="">` : '🧊'}</button>`
      ).join('');
      $('#galeria-thumbs').querySelectorAll('.thumb').forEach(t =>
        t.addEventListener('click', () => trocarImg(Number(t.dataset.i))));
    }

    // variedades
    const varsDiv = $('#variedades');
    if (produtoAtual.variedades && produtoAtual.variedades.length) {
      varsDiv.hidden = false;
      varsDiv.innerHTML = produtoAtual.variedades.map(v => {
        const esgotado = v.estoque === 0;
        const prc = v.preco == null ? produtoAtual.preco : v.preco;
        return `
        <button class="var-chip ${variedadeAtual && variedadeAtual.id === v.id ? 'ativo' : ''}" data-var="${v.id}" ${esgotado ? 'disabled' : ''}>
          <span class="var-nome">${v.nome}</span>
          ${esgotado ? '<span class="var-esgotado">Esgotado</span>' : `<span class="var-preco">${fmtBR(prc)}</span>`}
        </button>`;
      }).join('');
      varsDiv.querySelectorAll('.var-chip:not([disabled])').forEach(ch =>
        ch.addEventListener('click', () => escolherVariedade(Number(ch.dataset.var))));
    } else {
      varsDiv.hidden = true;
      varsDiv.innerHTML = '';
    }

    // unidade e quantidade
    $('#qtd-valor').textContent = qtd;
    $('#unidade-seletor').value = 'un';

    $('#modal').hidden = false;
    $('#modal-aviso').textContent = '';
    document.body.style.overflow = 'hidden';
  }

  function exibirPrecoModal() {
    const p = produtoAtual;
    const v = variedadeAtual;
    const unit = (v && v.preco != null) ? v.preco : (p ? p.preco : 0);
    const dz = (p && p.preco_dz != null && !v) ? p.preco_dz : unit * 10;
    const mostrar = unidadeAtual === 'dz' ? dz : unit;
    $('#modal-preco').innerHTML = `${fmtBR(mostrar)} <small>${unidadeAtual === 'dz' ? '/ dezena' : '/ un.'}</small>`;
  }

  function fecharModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
    produtoAtual = null;
  }

  function trocarImg(i) {
    imgAtual = i;
    const fotos = produtoAtual.fotos && produtoAtual.fotos.length ? produtoAtual.fotos : [null];
    $('#galeria-img').src = fotos[i];
    $('#galeria-thumbs').querySelectorAll('.thumb').forEach((t, idx) =>
      t.classList.toggle('ativo', idx === i));
  }

  function escolherVariedade(id) {
    variedadeAtual = produtoAtual.variedades.find(v => v.id === id) || null;
    $('#variedades').querySelectorAll('.var-chip').forEach(ch =>
      ch.classList.toggle('ativo', Number(ch.dataset.var) === id));
    exibirPrecoModal();
  }

  /* ---- adicionar ao carrinho ---- */
  $('#btn-add-carrinho').addEventListener('click', () => {
    if (!produtoAtual) return;
    const v = variedadeAtual;
    const unit = (v && v.preco != null) ? v.preco : (produtoAtual.preco || 0);
    const preco = unidadeAtual === 'dz'
      ? ((produtoAtual.preco_dz != null && !v) ? produtoAtual.preco_dz : unit * 10)
      : unit;
    const item = {
      produto_id: produtoAtual.id,
      variedade_id: v ? v.id : null,
      nome: produtoAtual.nome,
      variedade_nome: v ? v.nome : '',
      unidade: unidadeAtual,
      quantidade: qtd,
      preco_unitario: preco,
    };
    // se já existe o mesmo produto+variedade+unidade, soma quantidade
    const existente = carrinho.find(it =>
      it.produto_id === item.produto_id && it.variedade_id === item.variedade_id && it.unidade === item.unidade);
    if (existente) existente.quantidade = Math.min(999, existente.quantidade + item.quantidade);
    else carrinho.push(item);
    salvarCarrinho();
    fecharModal();
    $('#modal-aviso').textContent = '';
  });

  /* ---- eventos globais ---- */
  $('#qtd-mais').addEventListener('click', () => { qtd = Math.min(999, qtd + 1); $('#qtd-valor').textContent = qtd; });
  $('#qtd-menos').addEventListener('click', () => { qtd = Math.max(1, qtd - 1); $('#qtd-valor').textContent = qtd; });
  $('#unidade-seletor').addEventListener('change', (e) => { unidadeAtual = e.target.value; exibirPrecoModal(); });
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) fecharModal(); });
  $('#carrinho-wrap').addEventListener('click', (e) => { e.stopPropagation(); });
  $('#carrinho-toggle').addEventListener('click', () => {
    const painel = $('#carrinho-painel');
    painel.classList.toggle('aberto');
  });
  $('#carrinho-fechar').addEventListener('click', () => $('#carrinho-painel').classList.remove('aberto'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharModal(); fecharFinalizar(); } });
  $('#modal-finalizar-fechar').addEventListener('click', fecharFinalizar);
  $('#modal-finalizar').addEventListener('click', (e) => { if (e.target === $('#modal-finalizar')) fecharFinalizar(); });

  let debounceBusca = null;
  $('#busca').addEventListener('input', (e) => {
    clearTimeout(debounceBusca);
    debounceBusca = setTimeout(() => { busca = e.target.value.trim(); renderGrade(); }, 180);
  });

  /* ---- init ---- */
  async function init() {
    try {
      const [siteR, catR] = await Promise.all([fetch('/api/site'), fetch('/api/catalogo')]);
      SITE = await siteR.json();
      CATALOGO = await catR.json();
    } catch { return; }
    $('#site-titulo').textContent = SITE.titulo || 'Catálogo Algo+';
    $('#site-descricao').textContent = SITE.descricao || '';
    $('#rodape-texto').textContent = SITE.nota_rodape || '';
    document.title = SITE.titulo || 'Catálogo Algo+';
    aplicarTema();
    renderCategorias();
    renderGrade();
    carregarCarrinho();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
  init();
})();