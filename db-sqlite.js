'use strict';
/* ============================================================
 * CATÁLOGO VIRTUAL — camada de dados (SQLite via better-sqlite3)
 *
 * Modelo: categorias → produtos → fotos + variedades → pedidos
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'dados');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'catalogo.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------------- SCHEMA ---------------- */
/* migração entre versões de schema (bases criadas antes do multi-itens) */
function migrar() {
  try {
    const colsProdutos = db.prepare('PRAGMA table_info(produtos)').all().map(c => c.name);
    if (!colsProdutos.includes('preco_dz')) db.exec('ALTER TABLE produtos ADD COLUMN preco_dz REAL');
    const colsPedidos = db.prepare('PRAGMA table_info(pedidos)').all().map(c => c.name);
    if (colsPedidos.includes('produto_id')) {
      // schema antigo (pedido de 1 item): recria no formato multi-itens.
      // Catálogo ainda sem pedidos reais em produção → drop seguro.
      db.exec('DROP TABLE IF EXISTS pedido_itens');
      db.exec('DROP TABLE IF EXISTS pedidos');
      console.log('🔄 pedidos migrado para multi-itens (tabela recriada)');
    }
  } catch (e) { console.warn('migração opcional ignorada:', e.message); }
}
migrar();

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  icone TEXT NOT NULL DEFAULT '🛍️',
  descricao TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco REAL NOT NULL DEFAULT 0,          -- preço base (quando não há variedades)
  preco_dz REAL,                          -- preço da dezena (NULL = 10x o unitário)
  destaque INTEGER NOT NULL DEFAULT 0,     -- 1 = aparece no topo/destacado
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  capa INTEGER NOT NULL DEFAULT 0          -- 1 = foto principal do card/modal
);
CREATE TABLE IF NOT EXISTS variedades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,                       -- ex.: "Cor: Azul", "128 GB", "Tamanho M"
  preco REAL,                               -- NULL = usa o preço do produto
  estoque INTEGER,                          -- NULL = sem controle de estoque
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  dispositivo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',      -- novo|visto|atendido|cancelado
  pdf_url TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  variedade_id INTEGER REFERENCES variedades(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  variedade_nome TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL DEFAULT 'un',       -- un|dz  (unidade ou dezena)
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario REAL NOT NULL DEFAULT 0
);
`);

/* ---------------- HELPERS ---------------- */
function getSetting(chave, padrao = '') {
  const r = db.prepare('SELECT valor FROM settings WHERE chave = ?').get(chave);
  return r ? r.valor : padrao;
}
function setSetting(chave, valor) {
  db.prepare(
    'INSERT INTO settings (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  ).run(chave, String(valor));
}

/* ---- senha do admin ---- */
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verificarSenha(senha, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(senha, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function senhaDefinida() {
  return !!getSetting('senha_hash', '');
}
function definirSenha(senha) {
  if (!senha || String(senha).length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres');
  setSetting('senha_hash', hashSenha(String(senha)));
}

/* ---- sessões ---- */
function criarSessao() {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessoes (token, expira_em) VALUES (?, ?)').run(token, expira);
  return token;
}
function validarSessao(token) {
  if (!token) return false;
  const r = db.prepare('SELECT expira_em FROM sessoes WHERE token = ?').get(token);
  if (!r) return false;
  if (new Date(r.expira_em).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    return false;
  }
  return true;
}
function destruirSessao(token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

/* ---- categorias ---- */
function listarCategorias() {
  return db.prepare('SELECT * FROM categorias ORDER BY ordem, id').all();
}
function categoriaPorId(id) {
  return db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
}
function criarCategoria({ nome, icone, descricao, ordem, ativo }) {
  const info = db
    .prepare('INSERT INTO categorias (nome, icone, descricao, ordem, ativo) VALUES (?, ?, ?, ?, ?)')
    .run(nome, icone || '🛍️', descricao || '', ordem || 0, ativo === false ? 0 : 1);
  return info.lastInsertRowid;
}
function atualizarCategoria(id, { nome, icone, descricao, ordem, ativo }) {
  db.prepare('UPDATE categorias SET nome = ?, icone = ?, descricao = ?, ordem = ?, ativo = ? WHERE id = ?').run(
    nome, icone || '🛍️', descricao || '', ordem || 0, ativo === false ? 0 : 1, id
  );
}
function removerCategoria(id) {
  db.prepare('DELETE FROM categorias WHERE id = ?').run(id); // CASCADE leva produtos/fotos/variedades
}

/* ---- produtos ---- */
function listarProdutos() {
  return db.prepare('SELECT p.*, c.nome AS categoria_nome FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id ORDER BY p.destaque DESC, p.ordem, p.id').all();
}
function produtoPorId(id) {
  return db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
}
function criarProduto({ categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo }) {
  const info = db
    .prepare('INSERT INTO produtos (categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(categoria_id, nome, descricao || '', Number(preco) || 0, preco_dz === '' || preco_dz == null ? null : Number(preco_dz), destaque ? 1 : 0, ordem || 0, ativo === false ? 0 : 1);
  return info.lastInsertRowid;
}
function atualizarProduto(id, { categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo }) {
  db.prepare('UPDATE produtos SET categoria_id = ?, nome = ?, descricao = ?, preco = ?, preco_dz = ?, destaque = ?, ordem = ?, ativo = ? WHERE id = ?').run(
    categoria_id, nome, descricao || '', Number(preco) || 0, preco_dz === '' || preco_dz == null ? null : Number(preco_dz), destaque ? 1 : 0, ordem || 0, ativo === false ? 0 : 1, id
  );
}
function removerProduto(id) {
  db.prepare('DELETE FROM produtos WHERE id = ?').run(id); // CASCADE leva fotos e variedades
}

/* ---- fotos ---- */
function fotosDeProduto(produto_id) {
  return db.prepare('SELECT * FROM fotos WHERE produto_id = ? ORDER BY capa DESC, ordem, id').all(produto_id);
}
function fotoPorId(id) {
  return db.prepare('SELECT * FROM fotos WHERE id = ?').get(id);
}
function adicionarFoto(produto_id, url, capa = false) {
  const info = db
    .prepare('INSERT INTO fotos (produto_id, url, capa) VALUES (?, ?, ?)')
    .run(produto_id, url, capa ? 1 : 0);
  if (capa) {
    db.prepare('UPDATE fotos SET capa = 0 WHERE produto_id = ? AND id != ?').run(produto_id, info.lastInsertRowid);
  }
  return info.lastInsertRowid;
}
function definirCapa(id, produto_id) {
  db.prepare('UPDATE fotos SET capa = 0 WHERE produto_id = ?').run(produto_id);
  db.prepare('UPDATE fotos SET capa = 1 WHERE id = ?').run(id);
}
function removerFoto(id) {
  const f = db.prepare('SELECT * FROM fotos WHERE id = ?').get(id);
  if (f) db.prepare('DELETE FROM fotos WHERE id = ?').run(id);
  return f || null;
}

/* ---- variedades ---- */
function variedadesDeProduto(produto_id) {
  return db.prepare('SELECT * FROM variedades WHERE produto_id = ? ORDER BY ordem, id').all(produto_id);
}
function variedadePorId(id) {
  return db.prepare('SELECT * FROM variedades WHERE id = ?').get(id);
}
function criarVariedade({ produto_id, nome, preco, estoque, ordem, ativo }) {
  const info = db
    .prepare('INSERT INTO variedades (produto_id, nome, preco, estoque, ordem, ativo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(produto_id, nome, preco === '' || preco == null ? null : Number(preco), estoque === '' || estoque == null ? null : Number(estoque), ordem || 0, ativo === false ? 0 : 1);
  return info.lastInsertRowid;
}
function atualizarVariedade(id, { nome, preco, estoque, ordem, ativo }) {
  db.prepare('UPDATE variedades SET nome = ?, preco = ?, estoque = ?, ordem = ?, ativo = ? WHERE id = ?').run(
    nome, preco === '' || preco == null ? null : Number(preco), estoque === '' || estoque == null ? null : Number(estoque), ordem || 0, ativo === false ? 0 : 1, id
  );
}
function removerVariedade(id) {
  db.prepare('DELETE FROM variedades WHERE id = ?').run(id);
}

/* ---- pedidos (multi-itens) ---- */
function criarPedido({ itens, nome, whatsapp, observacao, dispositivo, pdf_url }) {
  const info = db
    .prepare('INSERT INTO pedidos (nome, whatsapp, observacao, dispositivo, pdf_url) VALUES (?, ?, ?, ?, ?)')
    .run(nome || '', whatsapp || '', observacao || '', dispositivo || '', pdf_url || '');
  const pedidoId = info.lastInsertRowid;
  const ins = db.prepare(
    'INSERT INTO pedido_itens (pedido_id, produto_id, variedade_id, produto_nome, variedade_nome, unidade, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const it of itens || []) {
    ins.run(pedidoId, it.produto_id, it.variedade_id || null, it.produto_nome || '', it.variedade_nome || '', it.unidade || 'un', Number(it.quantidade) || 1, Number(it.preco_unitario) || 0);
  }
  return pedidoId;
}
function itensDoPedido(pedido_id) {
  return db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(pedido_id);
}
function listarPedidos(status) {
  const pedidos = (status
    ? db.prepare('SELECT * FROM pedidos WHERE status = ? ORDER BY criado_em DESC').all(status)
    : db.prepare('SELECT * FROM pedidos ORDER BY criado_em DESC').all());
  for (const ped of pedidos) ped.itens = itensDoPedido(ped.id);
  return pedidos;
}
function atualizarStatusPedido(id, status) {
  db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(status, id);
}
function setPdfUrlPedido(id, pdf_url) {
  db.prepare('UPDATE pedidos SET pdf_url = ? WHERE id = ?').run(pdf_url || '', id);
}

/* ---- catálogo público (apenas ativos) ---- */
function catalogoCompleto() {
  const cats = db.prepare('SELECT * FROM categorias WHERE ativo = 1 ORDER BY ordem, id').all();
  const prods = db.prepare('SELECT * FROM produtos WHERE ativo = 1 ORDER BY destaque DESC, ordem, id').all();
  const fotos = db.prepare('SELECT * FROM fotos').all();
  const vars = db.prepare('SELECT * FROM variedades WHERE ativo = 1').all();
  const fotoDe = new Map();
  for (const f of fotos) {
    if (!fotoDe.has(f.produto_id)) fotoDe.set(f.produto_id, []);
    fotoDe.get(f.produto_id).push(f.url);
  }
  const varDe = new Map();
  for (const v of vars) {
    if (!varDe.has(v.produto_id)) varDe.set(v.produto_id, []);
    varDe.get(v.produto_id).push({
      id: v.id, nome: v.nome, preco: v.preco, estoque: v.estoque,
    });
  }
  return cats.map(c => ({
    id: c.id, nome: c.nome, icone: c.icone, descricao: c.descricao,
    produtos: prods
      .filter(p => p.categoria_id === c.id)
      .map(p => ({
        id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco,
        destaque: !!p.destaque, fotos: fotoDe.get(p.id) || [], variedades: varDe.get(p.id) || [],
      })),
  })).filter(c => c.produtos.length);
}

/* ---- configurações padrão ---- */
function configPadrao() {
  return {
    titulo: process.env.SITE_TITULO || 'Catálogo Algo+',
    descricao: process.env.SITE_DESCRICAO || 'Impressão 3D sob medida: decoração, personalizados e utilidades.',
    tema: process.env.TEMA || 'claro', // claro|escuro
    fundo_tipo: process.env.FUNDO_TIPO || 'cor', // cor|imagem|video
    fundo_valor: process.env.FUNDO_VALOR || '#F5F1EA',
    contato_whatsapp: process.env.CONTATO_WHATSAPP || '',
    contato_whatsapp_teste: process.env.CONTATO_WHATSAPP_TESTE || '',
    whatsapp_modo: process.env.WHATSAPP_MODO || 'oficial', // oficial|teste — qual número o site usa
    contato_email: process.env.CONTATO_EMAIL || '',
    pedido_personalizado: (process.env.PEDIDO_PERSONALIZADO || '1') === '1', // 1 = cliente informa nome/whatsapp; 0 = botão direto WhatsApp
    nota_rodape: process.env.NOTA_RODAPE || '',
  };
}
function getConfigCompleta() {
  const cfg = configPadrao();
  for (const k of Object.keys(cfg)) cfg[k] = getSetting('cfg_' + k, cfg[k]);
  return cfg;
}
function setConfigParcial(patch) {
  const cfg = configPadrao();
  for (const k of Object.keys(cfg)) {
    if (patch[k] !== undefined) setSetting('cfg_' + k, patch[k]);
  }
}

/* ---- painel (contagens) ---- */
function dashboard() {
  return {
    categorias: db.prepare('SELECT COUNT(*) c FROM categorias').get().c,
    produtos: db.prepare('SELECT COUNT(*) c FROM produtos').get().c,
    fotos: db.prepare('SELECT COUNT(*) c FROM fotos').get().c,
    variedades: db.prepare('SELECT COUNT(*) c FROM variedades').get().c,
    pedidos_novos: db.prepare("SELECT COUNT(*) c FROM pedidos WHERE status = 'novo'").get().c,
    pedidos_total: db.prepare('SELECT COUNT(*) c FROM pedidos').get().c,
    produtos_inativos: db.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo = 0').get().c,
  };
}

module.exports = {
  db, DATA_DIR, UPLOAD_DIR,
  getSetting, setSetting,
  senhaDefinida, definirSenha, verificarSenha,
  criarSessao, validarSessao, destruirSessao,
  listarCategorias, categoriaPorId, criarCategoria, atualizarCategoria, removerCategoria,
  listarProdutos, produtoPorId, criarProduto, atualizarProduto, removerProduto,
  fotosDeProduto, fotoPorId, adicionarFoto, definirCapa, removerFoto,
  variedadesDeProduto, variedadePorId, criarVariedade, atualizarVariedade, removerVariedade,
  criarPedido, itensDoPedido, listarPedidos, atualizarStatusPedido, setPdfUrlPedido,
  catalogoCompleto,
  configPadrao, getConfigCompleta, setConfigParcial,
  dashboard,
};