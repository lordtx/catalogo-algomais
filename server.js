'use strict';
/* ============================================================
 * CATÁLOGO VIRTUAL — vitrine de produtos + painel admin (Node + Express)
 *
 * Banco: DATABASE_URL (PostgreSQL) ou SQLite (padrão).
 * Arquivos: S3_ENDPOINT (MinIO/S3) ou disco local (padrão).
 *
 * Env vars (Coolify → Environment Variables):
 *   PAINEL_ADM        caminho reserva do painel admin (obrigatório)
 *   PAINEL_ADM_HOSTS  domínio(s) que abrem o painel (ex: cadm.dtxnet.top)
 *   SENHA_ADM         senha inicial do admin (trocável no painel)
 *   DATABASE_URL      connection string PostgreSQL (opcional; sem ela usa SQLite)
 *   S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_REGION  (MinIO/S3; opcional)
 *   NTFY_URL/TOPIC/TOKEN  notificações ntfy (opcional)
 *   SITE_TITULO, SITE_DESCRICAO, TEMA, FUNDO_*, CONTATO_*  (defaults do site)
 *   PEDIDO_PERSONALIZADO  1 (padrão: cliente informa nome/whatsapp) ou 0 (botão direto)
 *   DATA_DIR          pasta de dados (volume persistente) — padrão /data
 *   PORT              porta — padrão 3000
 * ============================================================ */
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const dbm = require('./db');
const storage = require('./storage');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PATH = (process.env.PAINEL_ADM || 'painel-admin').replace(/^\/+|\/+$/g, '');
const ADMIN_HOSTS = (process.env.PAINEL_ADM_HOSTS || '')
  .split(',').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')).filter(Boolean);
const PUBLICO_DIR = path.join(__dirname, 'public');

/* uploads em memória (storage.salvar grava em disco ou S3) */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB
});

/* ---------------- utilitários ---------------- */
function jsonErro(res, status, msg) {
  return res.status(status).json({ erro: msg });
}
function esc(s) { return String(s == null ? '' : s); }
function hostAdmin(req) {
  if (!ADMIN_HOSTS.length) return false;
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  return ADMIN_HOSTS.includes(host);
}

/* ---------------- notificação ntfy ---------------- */
function notificar(titulo, mensagem, anexoUrl) {
  const url = (process.env.NTFY_URL || '').replace(/\/+$/, '');
  const topico = process.env.NTFY_TOPIC || '';
  if (!url || !topico) return;
  const body = { topic: topico, title: titulo, message: mensagem, tags: ['shopping_cart'] };
  if (anexoUrl) body.attach = anexoUrl;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.NTFY_TOKEN) headers['Authorization'] = 'Bearer ' + process.env.NTFY_TOKEN;
  const req = http.request(url, { method: 'POST', headers }, res => { res.resume(); });
  req.on('error', () => {});
  req.write(JSON.stringify(body));
  req.end();
}

/* ---------------- auth admin ---------------- */
function sessaoToken(req) {
  const h = req.headers.cookie || '';
  for (const parte of h.split(';')) {
    const [k, v] = parte.trim().split('=');
    if (k === 'ctl_sessao') return decodeURIComponent(v);
  }
  return null;
}
async function exigirAdmin(req, res, next) {
  if (await dbm.validarSessao(sessaoToken(req))) return next();
  return jsonErro(res, 401, 'Não autorizado');
}

/* ---------------- preço exibido (variedade ou produto) ---------------- */
function precoDe(variedade, produtoPreco) {
  return (variedade && variedade.preco != null) ? variedade.preco : produtoPreco;
}

/* Preço efetivo de um item: unidade usa preço unitário; dezena usa preco_dz (ou 10x). */
function precoItem(produto, variedade, unidade) {
  const unit = (variedade && variedade.preco != null) ? variedade.preco : (produto.preco || 0);
  if (unidade === 'dz') {
    const dz = (produto.preco_dz != null && !(variedade && variedade.preco != null)) ? produto.preco_dz : null;
    return dz != null ? dz : unit * 10;
  }
  return unit;
}

/* Gera o PDF do pedido (pdfkit) e retorna o Buffer. */
function gerarPdfPedido({ id, nome, whatsapp, observacao, itens, titulo, descricao }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // cabeçalho
    doc.fontSize(18).fillColor('#16161d').text((titulo || 'Catálogo Algo+'), { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#6b6b76').text((descricao || ''), { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#16161d').text('Pedido #' + id);
    doc.fontSize(10).fillColor('#6b6b76')
      .text('Cliente: ' + (nome || '—') + (whatsapp ? '  ·  WhatsApp: ' + whatsapp : ''));
    if (observacao) {
      doc.moveDown(0.2);
      doc.fillColor('#b45309').text('Observação: ' + observacao);
    }
    doc.moveDown(0.8);

    // tabela de itens
    doc.fontSize(9).fillColor('#6b6b76');
    doc.text('ITEM'.padEnd(46) + 'QTD'.padStart(8) + 'UN'.padStart(6) + 'PREÇO'.padStart(14) + 'SUBTOTAL'.padStart(16));
    doc.moveDown(0.2);
    doc.strokeColor('#e8e3da').lineWidth(0.8).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);

    let total = 0;
    doc.fontSize(10).fillColor('#1c1c22');
    for (const it of (itens || [])) {
      const nomeProd = it.produto_nome + (it.variedade_nome ? ' · ' + it.variedade_nome : '');
      const un = it.unidade === 'dz' ? 'dz' : 'un';
      const sub = Number(it.preco_unitario) * Number(it.quantidade);
      total += sub;
      doc.text(
        nomeProd.slice(0, 44).padEnd(46) +
        String(it.quantidade).padStart(8) +
        un.padStart(6) +
        ('R$ ' + Number(it.preco_unitario).toFixed(2)).padStart(14) +
        ('R$ ' + sub.toFixed(2)).padStart(16),
        { lineGap: 4 }
      );
    }

    doc.moveDown(0.6);
    doc.strokeColor('#e8e3da').lineWidth(0.8).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.4);
    doc.fontSize(13).fillColor('#0f766e').text('TOTAL: R$ ' + total.toFixed(2), { align: 'right' });
    doc.moveDown(1.2);
    doc.fontSize(9).fillColor('#6b6b76')
      .text('Gerado em ' + new Date().toLocaleString('pt-BR') + ' — Catálogo Algo+', { align: 'center' });

    doc.end();
  });
}

/* Abre o WhatsApp do vendedor com o resumo do pedido (quando configurado). */
function linkWhatsAppPedido(numero, resumo) {
  if (!numero) return '';
  const n = String(numero).replace(/\D/g, '');
  return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(resumo) : '';
}

/* ============================================================
 * API PÚBLICA (vitrine do cliente)
 * ============================================================ */
app.get('/api/site', async (_req, res) => {
  res.json(await dbm.getConfigCompleta());
});

app.get('/api/catalogo', async (_req, res) => {
  res.json(await dbm.catalogoCompleto());
});

app.get('/api/produto/:id', async (req, res) => {
  const p = await dbm.produtoPorId(Number(req.params.id));
  if (!p || !p.ativo) return jsonErro(res, 404, 'Produto não encontrado');
  const c = await dbm.categoriaPorId(p.categoria_id);
  res.json({
    id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco,
    categoria: c ? { id: c.id, nome: c.nome, icone: c.icone } : null,
    fotos: (await dbm.fotosDeProduto(p.id)).map(f => f.url),
    variedades: (await dbm.variedadesDeProduto(p.id)).filter(v => v.ativo).map(v => ({
      id: v.id, nome: v.nome, preco: v.preco, estoque: v.estoque,
    })),
  });
});

app.post('/api/pedido', async (req, res) => {
  const { itens, nome, whatsapp, observacao, dispositivo } = req.body || {};
  if (!Array.isArray(itens) || !itens.length) {
    return jsonErro(res, 400, 'Escolha pelo menos um produto');
  }
  const cfg = await dbm.getConfigCompleta();

  // valida e monta os itens com nome/preço no momento do pedido (snapshot)
  const itensOk = [];
  for (const raw of itens) {
    const produtoId = Number(raw.produto_id);
    const p = await dbm.produtoPorId(produtoId);
    if (!p || !p.ativo) return jsonErro(res, 400, 'Produto inválido: #' + produtoId);
    let v = null;
    if (raw.variedade_id) {
      v = await dbm.variedadePorId(Number(raw.variedade_id));
      if (!v || v.produto_id !== produtoId || !v.ativo) return jsonErro(res, 400, 'Variedade inválida');
    }
    const unidade = raw.unidade === 'dz' ? 'dz' : 'un';
    const quantidade = Math.max(1, Number(raw.quantidade) || 1);
    itensOk.push({
      produto_id: produtoId,
      variedade_id: v ? v.id : null,
      produto_nome: p.nome,
      variedade_nome: v ? v.nome : '',
      unidade,
      quantidade,
      preco_unitario: precoItem(p, v, unidade),
    });
  }

  const id = await dbm.criarPedido({
    itens: itensOk,
    nome: esc(nome).slice(0, 200),
    whatsapp: esc(whatsapp).slice(0, 40),
    observacao: esc(observacao).slice(0, 1000),
    dispositivo: esc(dispositivo).slice(0, 100),
  });

  // gera o PDF
  let pdf_url = '';
  try {
    const pdf = await gerarPdfPedido({
      id,
      nome: esc(nome),
      whatsapp: esc(whatsapp),
      observacao: esc(observacao),
      itens: itensOk,
      titulo: cfg.titulo,
      descricao: cfg.descricao,
    });
    const arquivo = await storage.salvar(pdf, 'pedido-' + id + '.pdf');
    pdf_url = '/arquivos/' + arquivo;
    await dbm.setPdfUrlPedido(id, pdf_url);
  } catch (e) {
    console.warn('PDF não gerado:', e.message);
  }

  // resumo para ntfy e WhatsApp
  const total = itensOk.reduce((a, it) => a + it.preco_unitario * it.quantidade, 0);
  const linhas = itensOk.map(it =>
    `• ${it.produto_nome}${it.variedade_nome ? ' (' + it.variedade_nome + ')' : ''}: ${it.quantidade} ${it.unidade === 'dz' ? 'dezena(s)' : 'un.'} = R$ ${(it.preco_unitario * it.quantidade).toFixed(2)}`
  ).join('\n');
  const resumo = `Olá! Quero pedir (pedido #${id}):\n\n${linhas}\n\nTotal: R$ ${total.toFixed(2)}\nCliente: ${esc(nome) || 'Anônimo'}\nWhatsApp: ${esc(whatsapp) || '—'}`;

  notificar(
    '🛒 Novo pedido #' + id,
    resumo + (esc(observacao) ? '\n\n📝 Obs: ' + esc(observacao) : ''),
    pdf_url || undefined
  );

  res.json({
    ok: true, id,
    pdf_url,
    total: total.toFixed(2),
    whatsapp_url: linkWhatsAppPedido(cfg.contato_whatsapp, resumo),
  });
});

/* PDF do pedido (público, para download/cliente) */
app.get('/api/pedido/:id/pdf', async (req, res) => {
  const pedidos = await dbm.listarPedidos();
  const ped = pedidos.find(p => p.id === Number(req.params.id));
  if (!ped) return jsonErro(res, 404, 'Pedido não encontrado');
  if (!ped.pdf_url) return jsonErro(res, 404, 'PDF não disponível');
  const nome = (ped.pdf_url || '').replace('/arquivos/', '');
  return storage.servir(req, res, nome);
});

/* ============================================================
 * API ADMIN (sessão)
 * ============================================================ */
app.post('/api/admin/login', async (req, res) => {
  const { senha } = req.body || {};
  if (!(await dbm.senhaDefinida())) return jsonErro(res, 500, 'Senha de administrador não configurada');
  if (!dbm.verificarSenha(String(senha || ''), await dbm.getSetting('senha_hash', ''))) {
    return jsonErro(res, 401, 'Senha incorreta');
  }
  const token = await dbm.criarSessao();
  res.setHeader('Set-Cookie', `ctl_sessao=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', exigirAdmin, async (req, res) => {
  await dbm.destruirSessao(sessaoToken(req));
  res.setHeader('Set-Cookie', 'ctl_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', exigirAdmin, (_req, res) => {
  res.json({ ok: true, painel: '/' + ADMIN_PATH });
});

app.get('/api/admin/dashboard', exigirAdmin, async (_req, res) => {
  res.json(await dbm.dashboard());
});

/* ---- categorias ---- */
app.get('/api/admin/categorias', exigirAdmin, async (_req, res) => {
  res.json(await dbm.listarCategorias());
});
app.post('/api/admin/categorias', exigirAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return jsonErro(res, 400, 'Nome da categoria é obrigatório');
  const id = await dbm.criarCategoria(b);
  res.json({ ok: true, id });
});
app.put('/api/admin/categorias/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!b.nome) return jsonErro(res, 400, 'Nome da categoria é obrigatório');
  if (!(await dbm.categoriaPorId(id))) return jsonErro(res, 404, 'Categoria não encontrada');
  await dbm.atualizarCategoria(id, b);
  res.json({ ok: true });
});
app.delete('/api/admin/categorias/:id', exigirAdmin, async (req, res) => {
  await dbm.removerCategoria(Number(req.params.id));
  res.json({ ok: true });
});

/* ---- produtos ---- */
app.get('/api/admin/produtos', exigirAdmin, async (_req, res) => {
  res.json(await dbm.listarProdutos());
});
app.get('/api/admin/produtos/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const p = await dbm.produtoPorId(id);
  if (!p) return jsonErro(res, 404, 'Produto não encontrado');
  res.json({
    ...p,
    fotos: await dbm.fotosDeProduto(id),
    variedades: await dbm.variedadesDeProduto(id),
  });
});
app.post('/api/admin/produtos', exigirAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.categoria_id || !b.nome) return jsonErro(res, 400, 'Categoria e nome são obrigatórios');
  if (!(await dbm.categoriaPorId(Number(b.categoria_id)))) return jsonErro(res, 400, 'Categoria inválida');
  const id = await dbm.criarProduto(b);
  res.json({ ok: true, id });
});
app.put('/api/admin/produtos/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!(await dbm.produtoPorId(id))) return jsonErro(res, 404, 'Produto não encontrado');
  await dbm.atualizarProduto(id, b);
  res.json({ ok: true });
});
app.delete('/api/admin/produtos/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const p = await dbm.produtoPorId(id);
  if (p) {
    for (const f of await dbm.fotosDeProduto(id)) {
      const nome = (f.url || '').replace('/arquivos/', '');
      await storage.remover(nome);
    }
  }
  await dbm.removerProduto(id);
  res.json({ ok: true });
});

/* ---- fotos ---- */
app.post('/api/admin/produtos/:id/fotos', exigirAdmin, upload.single('arquivo'), async (req, res) => {
  const id = Number(req.params.id);
  if (!(await dbm.produtoPorId(id))) return jsonErro(res, 404, 'Produto não encontrado');
  if (!req.file) return jsonErro(res, 400, 'Envie um arquivo');
  const nome = await storage.salvar(req.file.buffer, req.file.originalname);
  const fotos = await dbm.fotosDeProduto(id);
  const fotoId = await dbm.adicionarFoto(id, '/arquivos/' + nome, fotos.length === 0);
  res.json({ ok: true, foto_id: fotoId, url: '/arquivos/' + nome });
});
app.post('/api/admin/fotos/:id/capa', exigirAdmin, async (req, res) => {
  const f = await dbm.fotoPorId(Number(req.params.id));
  if (!f) return jsonErro(res, 404, 'Foto não encontrada');
  await dbm.definirCapa(f.id, f.produto_id);
  res.json({ ok: true });
});
app.delete('/api/admin/fotos/:id', exigirAdmin, async (req, res) => {
  const f = await dbm.removerFoto(Number(req.params.id));
  if (!f) return jsonErro(res, 404, 'Foto não encontrada');
  const nome = (f.url || '').replace('/arquivos/', '');
  await storage.remover(nome);
  res.json({ ok: true });
});

/* ---- variedades ---- */
app.get('/api/admin/produtos/:id/variedades', exigirAdmin, async (req, res) => {
  res.json(await dbm.variedadesDeProduto(Number(req.params.id)));
});
app.post('/api/admin/produtos/:id/variedades', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!(await dbm.produtoPorId(id))) return jsonErro(res, 404, 'Produto não encontrado');
  const b = req.body || {};
  if (!b.nome) return jsonErro(res, 400, 'Nome da variedade é obrigatório');
  const vId = await dbm.criarVariedade({ ...b, produto_id: id });
  res.json({ ok: true, id: vId });
});
app.put('/api/admin/variedades/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!(await dbm.variedadePorId(id))) return jsonErro(res, 404, 'Variedade não encontrada');
  await dbm.atualizarVariedade(id, req.body || {});
  res.json({ ok: true });
});
app.delete('/api/admin/variedades/:id', exigirAdmin, async (req, res) => {
  await dbm.removerVariedade(Number(req.params.id));
  res.json({ ok: true });
});

/* ---- pedidos ---- */
app.get('/api/admin/pedidos', exigirAdmin, async (req, res) => {
  const status = req.query.status || '';
  res.json(await dbm.listarPedidos(status || null));
});
app.put('/api/admin/pedidos/:id/status', exigirAdmin, async (req, res) => {
  const status = (req.body || {}).status || '';
  if (!['novo', 'visto', 'atendido', 'cancelado'].includes(status)) {
    return jsonErro(res, 400, 'Status inválido');
  }
  await dbm.atualizarStatusPedido(Number(req.params.id), status);
  res.json({ ok: true });
});

/* ---- upload avulso (fontes, fundos etc.) ---- */
app.post('/api/admin/upload', exigirAdmin, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return jsonErro(res, 400, 'Envie um arquivo');
  const nome = await storage.salvar(req.file.buffer, req.file.originalname);
  res.json({ ok: true, url: '/arquivos/' + nome, nome: req.file.originalname });
});

/* ---- configurações ---- */
app.get('/api/admin/config', exigirAdmin, async (_req, res) => {
  res.json({
    config: await dbm.getConfigCompleta(),
    painel_path: '/' + ADMIN_PATH,
    painel_hosts: ADMIN_HOSTS.join(', '),
    banco: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
    storage: storage.s3Ativo() ? 's3' : 'disco',
    ntfy: !!(process.env.NTFY_URL && process.env.NTFY_TOPIC),
  });
});
app.put('/api/admin/config', exigirAdmin, async (req, res) => {
  await dbm.setConfigParcial(req.body || {});
  res.json({ ok: true });
});
app.put('/api/admin/senha', exigirAdmin, async (req, res) => {
  const { senha_atual, nova_senha } = req.body || {};
  if (!dbm.verificarSenha(String(senha_atual || ''), await dbm.getSetting('senha_hash', ''))) {
    return jsonErro(res, 401, 'Senha atual incorreta');
  }
  try {
    await dbm.definirSenha(nova_senha);
    notificar('🔑 Senha do painel alterada', 'A senha de administrador foi alterada.');
    res.json({ ok: true });
  } catch (e) {
    return jsonErro(res, 400, e.message);
  }
});

/* ============================================================
 * ARQUIVOS + ESTÁTICOS
 * ============================================================ */
app.get('/arquivos/:nome', (req, res) => storage.servir(req, res, req.params.nome));

// painel admin: domínio dedicado ou caminho reserva
app.get('/' + ADMIN_PATH, (_req, res) => {
  res.sendFile(path.join(PUBLICO_DIR, 'admin.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLICO_DIR, hostAdmin(req) ? 'admin.html' : 'index.html'));
});

app.use(express.static(PUBLICO_DIR));

// SPA fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/arquivos/')) return jsonErro(res, 404, 'Não encontrado');
  res.sendFile(path.join(PUBLICO_DIR, hostAdmin(req) ? 'admin.html' : 'index.html'));
});

/* ---------------- boot ---------------- */
(async () => {
  if (dbm.inicializar) await dbm.inicializar(); // PostgreSQL: cria schema

  if (!process.env.PAINEL_ADM) {
    console.warn('⚠ PAINEL_ADM não definido — usando caminho padrão: /' + ADMIN_PATH + ' (defina no Coolify!)');
  }
  if (ADMIN_HOSTS.length) {
    console.log('✔ Domínio(s) do painel admin: ' + ADMIN_HOSTS.join(', '));
  } else {
    console.warn('⚠ PAINEL_ADM_HOSTS vazio — painel acessível apenas pelo caminho /' + ADMIN_PATH);
  }
  if (!(await dbm.senhaDefinida())) {
    const senhaInicial = process.env.SENHA_ADM || 'admin1234';
    await dbm.definirSenha(senhaInicial);
    console.warn('⚠ Senha do admin inicializada' + (process.env.SENHA_ADM ? ' a partir de SENHA_ADM' : ' com o padrão (defina SENHA_ADM no Coolify!)'));
  }
  if (!process.env.NTFY_URL || !process.env.NTFY_TOPIC) {
    console.warn('⚠ NTFY_URL/NTFY_TOPIC ausentes — notificações desabilitadas');
  }
  if (storage.s3Ativo()) await storage.garantirBucket();
  console.log('✔ Banco: ' + (process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'));
  console.log('✔ Arquivos: ' + (storage.s3Ativo() ? 'S3 (' + process.env.S3_ENDPOINT + ')' : 'disco local (' + storage.UPLOAD_DIR + ')'));

  app.listen(PORT, () => {
    console.log(`✔ Catálogo Virtual rodando em http://0.0.0.0:${PORT}`);
    console.log(`✔ Painel admin: /${ADMIN_PATH}`);
    console.log(`✔ Dados em: ${dbm.DATA_DIR || process.env.DATA_DIR || '/data'}`);
  });
})().catch(e => {
  console.error('❌ Falha no boot:', e);
  process.exit(1);
});