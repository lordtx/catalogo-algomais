'use strict';
/* ============================================================
   CATÁLOGO VIRTUAL — painel admin
   ============================================================ */
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const STATE = { view: 'dashboard', pedidosStatus: '', categorias: [], produtos: [] };

  /* ---------------- auth ---------------- */
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-erro').hidden = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: { senha: $('#login-senha').value } });
      entrar();
    } catch (err) {
      $('#login-erro').textContent = err.message;
      $('#login-erro').hidden = false;
    }
  });

  $('#btn-sair').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    location.reload();
  });

  async function entrar() {
    $('#tela-login').hidden = true;
    $('#app').hidden = false;
    await carregarTudo();
  }

  /* ---------------- navegação ---------------- */
  $$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => mudarView(btn.dataset.view)));

  function mudarView(view) {
    STATE.view = view;
    $$('.nav-item[data-view]').forEach(b => b.classList.toggle('ativo', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('ativo', v.id === 'view-' + view));
    if (view === 'dashboard') renderDashboard();
    if (view === 'categorias') renderCategorias();
    if (view === 'produtos') renderProdutos();
    if (view === 'pedidos') renderPedidos();
    if (view === 'config') renderConfig();
  }

  /* ---------------- carregamento ---------------- */
  async function carregarTudo() {
    const [dashboard, categorias, produtos] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/categorias'),
      api('/api/admin/produtos'),
    ]);
    STATE.categorias = categorias;
    STATE.produtos = produtos;
    STATE.dashboard = dashboard;
    if (dashboard.pedidos_novos > 0) {
      $('#badge-pedidos').textContent = dashboard.pedidos_novos;
      $('#badge-pedidos').hidden = false;
    }
    renderDashboard();
  }

  /* ---------------- dashboard ---------------- */
  function renderDashboard() {
    const d = STATE.dashboard || {};
    const cards = [
      ['🗂️', 'Categorias', d.categorias || 0],
      ['📦', 'Produtos', d.produtos || 0],
      ['🖼️', 'Fotos', d.fotos || 0],
      ['🌈', 'Variedades', d.variedades || 0],
      ['🛒', 'Pedidos novos', d.pedidos_novos || 0],
      ['📋', 'Pedidos total', d.pedidos_total || 0],
    ];
    $('#stats').innerHTML = cards.map(([icone, nome, valor]) => `
      <div class="stat-card">
        <div class="stat-icone">${icone}</div>
        <div class="stat-nome">${nome}</div>
        <div class="stat-valor">${valor}</div>
      </div>`).join('');
  }

  /* ---------------- categorias ---------------- */
  async function renderCategorias() {
    const lista = await api('/api/admin/categorias');
    STATE.categorias = lista;
    const contagem = {};
    for (const p of STATE.produtos) contagem[p.categoria_id] = (contagem[p.categoria_id] || 0) + 1;
    $('#lista-categorias').innerHTML = lista.length ? lista.map(c => `
      <div class="item-linha">
        <div class="item-info">
          <span class="item-icone">${esc(c.icone)}</span>
          <div>
            <strong>${esc(c.nome)}</strong>
            <small>${esc(c.descricao || '')} · ${contagem[c.id] || 0} produtos${c.ativo ? '' : ' · ⏸ inativa'}</small>
          </div>
        </div>
        <div class="item-acoes">
          <button class="btn pequeno" data-editar="${c.id}">✏️ Editar</button>
          <button class="btn pequeno perigo" data-remover="${c.id}">🗑️</button>
        </div>
      </div>`).join('') : '<p class="vazio-lista">Nenhuma categoria. Crie a primeira!</p>';

    lista.forEach(c => {
      const el = $('#lista-categorias').querySelector(`[data-editar="${c.id}"]`);
      el.addEventListener('click', () => modalCategoria(c));
      const rm = $('#lista-categorias').querySelector(`[data-remover="${c.id}"]`);
      rm.addEventListener('click', () => removerCategoria(c));
    });
  }

  $('#btn-nova-categoria').addEventListener('click', () => modalCategoria(null));

  function modalCategoria(c) {
    $('#modal-conteudo').innerHTML = `
      <h3>${c ? 'Editar categoria' : 'Nova categoria'}</h3>
      <form id="form-categoria" class="form-painel">
        <label>Nome (obrigatório)<input name="nome" value="${esc(c ? c.nome : '')}" required></label>
        <label>Ícone (emoji)<input name="icone" value="${esc(c ? c.icone : '🛍️')}" maxlength="8"></label>
        <label>Descrição<textarea name="descricao" rows="2">${esc(c ? c.descricao : '')}</textarea></label>
        <label>Ordem<input type="number" name="ordem" value="${c ? c.ordem : 0}"></label>
        <label class="check"><input type="checkbox" name="ativo" ${!c || c.ativo ? 'checked' : ''}> Ativa</label>
        <div class="modal-acoes">
          <button type="submit" class="btn btn-primario">Salvar</button>
          <button type="button" class="btn" onclick="document.getElementById('modal').hidden=true">Cancelar</button>
        </div>
      </form>`;
    abrirModal();
    $('#form-categoria').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        nome: f.nome.value.trim(),
        icone: f.icone.value.trim() || '🛍️',
        descricao: f.descricao.value.trim(),
        ordem: Number(f.ordem.value) || 0,
        ativo: f.ativo.checked,
      };
      if (c) await api('/api/admin/categorias/' + c.id, { method: 'PUT', body });
      else await api('/api/admin/categorias', { method: 'POST', body });
      fecharModal();
      await carregarTudo();
      mudarView('categorias');
    });
  }

  async function removerCategoria(c) {
    if (!confirm(`Excluir a categoria "${c.nome}"? Todos os produtos dela serão apagados.`)) return;
    await api('/api/admin/categorias/' + c.id, { method: 'DELETE' });
    await carregarTudo();
    mudarView('categorias');
  }

  /* ---------------- produtos ---------------- */
  async function renderProdutos() {
    STATE.produtos = await api('/api/admin/produtos');
    const catNome = id => (STATE.categorias.find(c => c.id === id) || {}).nome || '—';
    $('#lista-produtos').innerHTML = STATE.produtos.length ? STATE.produtos.map(p => `
      <div class="item-linha">
        <div class="item-info">
          <span class="item-icone">${p.destaque ? '⭐' : '📦'}</span>
          <div>
            <strong>${esc(p.nome)}</strong>
            <small>${esc(catNome(p.categoria_id))} · ${fmtBR(p.preco)}${p.ativo ? '' : ' · ⏸ inativo'}</small>
          </div>
        </div>
        <div class="item-acoes">
          <button class="btn pequeno" data-editar="${p.id}">✏️ Editar</button>
          <button class="btn pequeno perigo" data-remover="${p.id}">🗑️</button>
        </div>
      </div>`).join('') : '<p class="vazio-lista">Nenhum produto. Crie o primeiro!</p>';

    STATE.produtos.forEach(p => {
      $('#lista-produtos').querySelector(`[data-editar="${p.id}"]`).addEventListener('click', () => modalProduto(p.id));
      $('#lista-produtos').querySelector(`[data-remover="${p.id}"]`).addEventListener('click', () => removerProduto(p));
    });
  }

  $('#btn-novo-produto').addEventListener('click', () => modalProduto(null));

  async function modalProduto(id) {
    const p = id ? await api('/api/admin/produtos/' + id) : {
      id: null, categoria_id: STATE.categorias[0] ? STATE.categorias[0].id : '', nome: '',
      descricao: '', preco: '', destaque: 0, ordem: 0, ativo: 1, fotos: [], variedades: [],
    };
    const ops = STATE.categorias.map(c => `<option value="${c.id}" ${p.categoria_id === c.id ? 'selected' : ''}>${esc(c.icone)} ${esc(c.nome)}</option>`).join('');

    $('#modal-conteudo').innerHTML = `
      <h3>${p.id ? 'Editar produto' : 'Novo produto'}</h3>
      <form id="form-produto" class="form-painel">
        <label>Categoria<select name="categoria_id" required>${ops}</select></label>
        <label>Nome (obrigatório)<input name="nome" value="${esc(p.nome)}" required></label>
        <label>Descrição<textarea name="descricao" rows="3">${esc(p.descricao)}</textarea></label>
        <label>Preço base (R$)<input type="number" name="preco" step="0.01" value="${p.preco || ''}" placeholder="0.00"></label>
        <div class="linha-2">
          <label>Ordem<input type="number" name="ordem" value="${p.ordem || 0}"></label>
          <label class="check"><input type="checkbox" name="destaque" ${p.destaque ? 'checked' : ''}> ⭐ Destaque</label>
        </div>
        <label class="check"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</label>

        <h4>📷 Fotos</h4>
        <div class="fotos-grade" id="fotos-grade"></div>
        <label class="upload-linha">
          <input type="file" id="input-foto" accept="image/*" multiple hidden>
          <span class="btn">+ Adicionar fotos</span>
        </label>

        <h4>🌈 Variedades <span class="hint">(cores, tamanhos, capacidades…)</span></h4>
        <div class="var-lista" id="var-lista"></div>
        <button type="button" class="btn pequeno" id="btn-add-var">+ Adicionar variedade</button>

        <div class="modal-acoes">
          <button type="submit" class="btn btn-primario">Salvar produto</button>
          <button type="button" class="btn" onclick="document.getElementById('modal').hidden=true">Cancelar</button>
        </div>
      </form>`;
    abrirModal();

    /* --- fotos --- */
    const renderFotos = () => {
      $('#fotos-grade').innerHTML = (p.fotos || []).map(f => `
        <div class="foto-cell ${f.capa ? 'capa' : ''}">
          <img src="${f.url}" alt="">
          ${f.capa ? '<span class="marca-capa">Capa</span>' : `<button class="mini-btn" data-capa="${f.id}">⭐</button>`}
          <button class="mini-btn x" data-rmfoto="${f.id}">✕</button>
        </div>`).join('') || '<p class="vazio-lista">Sem fotos ainda.</p>';
      $$('#fotos-grade [data-capa]').forEach(b => b.addEventListener('click', async () => {
        await api('/api/admin/fotos/' + b.dataset.capa + '/capa', { method: 'POST' });
        p.fotos = (await api('/api/admin/produtos/' + p.id)).fotos;
        renderFotos();
      }));
      $$('#fotos-grade [data-rmfoto]').forEach(b => b.addEventListener('click', async () => {
        await api('/api/admin/fotos/' + b.dataset.rmfoto, { method: 'DELETE' });
        p.fotos = (await api('/api/admin/produtos/' + p.id)).fotos;
        renderFotos();
      }));
    };
    renderFotos();

    if (!p.id) {
      // novo produto: cria o registro primeiro para poder subir fotos
      $('#input-foto').addEventListener('change', async (e) => {
        const arquivos = [...e.target.files];
        if (!arquivos.length) return;
        if (!p.id) {
          const f = $('#form-produto');
          const novo = await api('/api/admin/produtos', { method: 'POST', body: {
            categoria_id: Number(f.categoria_id.value), nome: f.nome.value.trim() || 'Produto sem nome',
            descricao: f.descricao.value.trim(), preco: Number(f.preco.value) || 0,
            destaque: f.destaque.checked, ordem: Number(f.ordem.value) || 0, ativo: f.ativo.checked,
          }});
          p.id = novo.id;
        }
        for (const arq of arquivos) await apiUpload('/api/admin/produtos/' + p.id + '/fotos', arq);
        p.fotos = (await api('/api/admin/produtos/' + p.id)).fotos;
        renderFotos();
        e.target.value = '';
      });
    } else {
      $('#input-foto').addEventListener('change', async (e) => {
        for (const arq of [...e.target.files]) await apiUpload('/api/admin/produtos/' + p.id + '/fotos', arq);
        p.fotos = (await api('/api/admin/produtos/' + p.id)).fotos;
        renderFotos();
        e.target.value = '';
      });
    }

    /* --- variedades --- */
    const renderVars = () => {
      $('#var-lista').innerHTML = (p.variedades || []).map(v => `
        <div class="var-linha">
          <input class="v-nome" value="${esc(v.nome)}" placeholder="Ex.: Cor Azul">
          <input class="v-preco" type="number" step="0.01" value="${v.preco == null ? '' : v.preco}" placeholder="Preço (opcional)">
          <input class="v-estoque" type="number" value="${v.estoque == null ? '' : v.estoque}" placeholder="Estoque">
          <button class="mini-btn x" data-rmvar="${v.id}">✕</button>
        </div>`).join('') || '<p class="vazio-lista">Sem variedades (produto com preço único).</p>';
      $$('#var-lista [data-rmvar]').forEach(b => b.addEventListener('click', async () => {
        await api('/api/admin/variedades/' + b.dataset.rmvar, { method: 'DELETE' });
        p.variedades = (await api('/api/admin/produtos/' + p.id)).variedades;
        renderVars();
      }));
    };
    renderVars();

    $('#btn-add-var').addEventListener('click', () => {
      if (!p.id) {
        const f = $('#form-produto');
        const nome = f.nome.value.trim() || 'Produto sem nome';
        alert('Salve o produto primeiro (nome: "' + nome + '") para poder adicionar variedades.');
        return;
      }
      p.variedades.push({ id: null, nome: '', preco: null, estoque: null });
      renderVars();
    });

    /* --- salvar --- */
    $('#form-produto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        categoria_id: Number(f.categoria_id.value),
        nome: f.nome.value.trim(),
        descricao: f.descricao.value.trim(),
        preco: Number(f.preco.value) || 0,
        destaque: f.destaque.checked,
        ordem: Number(f.ordem.value) || 0,
        ativo: f.ativo.checked,
      };
      let novoId = p.id;
      if (p.id) await api('/api/admin/produtos/' + p.id, { method: 'PUT', body });
      else novoId = (await api('/api/admin/produtos', { method: 'POST', body })).id;

      // variedades (somente quando o produto já existe)
      if (novoId) {
        const linhas = $$('#var-lista .var-linha');
        for (const [i, linha] of linhas.entries()) {
          const nome = linha.querySelector('.v-nome').value.trim();
          const precoRaw = linha.querySelector('.v-preco').value;
          const estoqueRaw = linha.querySelector('.v-estoque').value;
          if (!nome) continue;
          const payload = {
            nome,
            preco: precoRaw === '' ? null : Number(precoRaw),
            estoque: estoqueRaw === '' ? null : Number(estoqueRaw),
          };
          const existente = (p.variedades || [])[i];
          if (existente && existente.id) await api('/api/admin/variedades/' + existente.id, { method: 'PUT', body: payload });
          else await api('/api/admin/produtos/' + novoId + '/variedades', { method: 'POST', body: payload });
        }
      }
      fecharModal();
      await carregarTudo();
      mudarView('produtos');
    });
  }

  async function removerProduto(p) {
    if (!confirm(`Excluir o produto "${p.nome}"?`)) return;
    await api('/api/admin/produtos/' + p.id, { method: 'DELETE' });
    await carregarTudo();
    mudarView('produtos');
  }

  /* ---------------- pedidos ---------------- */
  $$('.filtro-status .filtro').forEach(f => f.addEventListener('click', async () => {
    $$('.filtro-status .filtro').forEach(x => x.classList.remove('ativo'));
    f.classList.add('ativo');
    STATE.pedidosStatus = f.dataset.status || '';
    await renderPedidos();
  }));

  async function renderPedidos() {
    const q = STATE.pedidosStatus ? '?status=' + STATE.pedidosStatus : '';
    const pedidos = await api('/api/admin/pedidos' + q);
    const st = {
      novo: ['novo', 'Novo'],
      visto: ['info', 'Visto'],
      atendido: ['ok', 'Atendido'],
      cancelado: ['x', 'Cancelado'],
    };
    $('#lista-pedidos').innerHTML = pedidos.length ? pedidos.map(pd => {
      const itens = pd.itens || [];
      const total = itens.reduce((a, it) => a + Number(it.preco_unitario) * Number(it.quantidade), 0);
      const itensHtml = itens.map(it => `
        <span class="ped-item">
          ${esc(it.produto_nome)}${it.variedade_nome ? ' · ' + esc(it.variedade_nome) : ''}
          — ${it.quantidade} ${it.unidade === 'dz' ? 'dz' : 'un.'} × ${fmtBR(it.preco_unitario)} = ${fmtBR(Number(it.preco_unitario) * Number(it.quantidade))}
        </span>`).join('');
      return `
      <div class="item-linha pedido-linha" data-status="${pd.status}">
        <div class="item-info">
          <span class="status-ponto status-${st[pd.status] ? st[pd.status][0] : 'novo'}"></span>
          <div>
            <strong>#${pd.id} · ${esc(pd.nome || 'Anônimo')} · ${esc(pd.whatsapp || '—')}</strong>
            <small class="ped-itens">${itensHtml || '—'}</small>
            <small><strong>Total: ${fmtBR(total)}</strong></small>
            ${pd.observacao ? `<small class="obs">📝 ${esc(pd.observacao)}</small>` : ''}
            ${pd.pdf_url ? `<small><a class="link-pdf" href="${pd.pdf_url}" target="_blank">📄 PDF do pedido</a></small>` : ''}
            <small class="data">${esc(pd.criado_em)}</small>
          </div>
        </div>
        <div class="item-acoes">
          <select class="sel-status" data-id="${pd.id}">
            ${Object.entries(st).map(([k, [, label]]) => `<option value="${k}" ${pd.status === k ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }).join('') : '<p class="vazio-lista">Nenhum pedido aqui.</p>';

    $$('#lista-pedidos .sel-status').forEach(sel => sel.addEventListener('change', async () => {
      await api('/api/admin/pedidos/' + sel.dataset.id + '/status', { method: 'PUT', body: { status: sel.value } });
      await renderPedidos();
      await carregarTudo();
    }));
  }

  /* ---------------- configurações ---------------- */
  async function renderConfig() {
    const { config, painel_path, painel_hosts, banco, storage, ntfy } = await api('/api/admin/config');
    $('#cfg-titulo').value = config.titulo || '';
    $('#cfg-descricao').value = config.descricao || '';
    $('#cfg-tema').value = config.tema || 'claro';
    $('#cfg-whatsapp').value = config.contato_whatsapp || '';
    $('#cfg-email').value = config.contato_email || '';
    $('#cfg-pedido-personalizado').checked = config.pedido_personalizado !== false;
    $('#cfg-rodape').value = config.nota_rodape || '';
    $('#info-sistema').innerHTML = `
      <p><strong>Banco:</strong> ${banco} · <strong>Arquivos:</strong> ${storage}</p>
      <p><strong>Painel:</strong> ${painel_path} ${painel_hosts ? '· ' + painel_hosts : ''} · <strong>ntfy:</strong> ${ntfy ? 'on' : 'off'}</p>`;
  }

  $('#form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/admin/config', { method: 'PUT', body: {
      titulo: $('#cfg-titulo').value.trim(),
      descricao: $('#cfg-descricao').value.trim(),
      tema: $('#cfg-tema').value,
      contato_whatsapp: $('#cfg-whatsapp').value.trim(),
      contato_email: $('#cfg-email').value.trim(),
      pedido_personalizado: $('#cfg-pedido-personalizado').checked,
      nota_rodape: $('#cfg-rodape').value.trim(),
    }});
    $('#cfg-salvo').hidden = false;
    setTimeout(() => { $('#cfg-salvo').hidden = true; }, 2500);
  });

  $('#form-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#senha-msg');
    msg.hidden = false;
    try {
      await api('/api/admin/senha', { method: 'PUT', body: {
        senha_atual: $('#senha-atual').value, nova_senha: $('#nova-senha').value,
      }});
      msg.textContent = '✅ Senha alterada!';
      msg.className = 'ok-msg';
      e.target.reset();
    } catch (err) {
      msg.textContent = '❌ ' + err.message;
      msg.className = 'ok-msg erro';
    }
  });

  /* ---------------- modal helpers ---------------- */
  function abrirModal() {
    $('#modal').hidden = false;
  }
  function fecharModal() {
    $('#modal').hidden = true;
    $('#modal-conteudo').innerHTML = '';
  }
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

  /* ---------------- init ---------------- */
  (async () => {
    try {
      await api('/api/admin/me', { noReload: true });
      entrar();
    } catch { /* sem sessão → login */ }
  })();
})();