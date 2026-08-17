'use strict';
/* ============================================================
 * CATÁLOGO VIRTUAL — camada de dados PostgreSQL (adapter async)
 * Mesma interface do db-sqlite.js; selecionado quando DATABASE_URL existe.
 * ============================================================ */
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'dados');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

/* ---------------- schema ---------------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL,
  icone TEXT NOT NULL DEFAULT '🛍️',
  descricao TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco REAL NOT NULL DEFAULT 0,
  preco_dz REAL,
  destaque INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  capa INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS variedades (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  preco REAL,
  estoque INTEGER,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  dispositivo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',
  pdf_url TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  variedade_id INTEGER REFERENCES variedades(id) ON DELETE SET NULL,
  produto_nome TEXT NOT NULL,
  variedade_nome TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL DEFAULT 'un',
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario REAL NOT NULL DEFAULT 0
);
`;

async function inicializar() {
  await pool.query(SCHEMA);
  // migração entre versões de schema
  try {
    await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_dz REAL");
    // schema antigo (pedidos com produto_id): recria no formato multi-itens.
    const r = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'pedidos' AND column_name = 'produto_id'"
    );
    if (r.rows.length) {
      await pool.query('ALTER TABLE pedido_itens DROP CONSTRAINT IF EXISTS pedido_itens_pedido_id_fkey');
      await pool.query('DROP TABLE IF EXISTS pedido_itens');
      await pool.query('DROP TABLE IF EXISTS pedidos');
      await pool.query(
        `CREATE TABLE pedidos (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          nome TEXT NOT NULL DEFAULT '',
          whatsapp TEXT NOT NULL DEFAULT '',
          observacao TEXT NOT NULL DEFAULT '',
          dispositivo TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'novo',
          pdf_url TEXT NOT NULL DEFAULT '',
          criado_em TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
        )`
      );
      await pool.query(
        `CREATE TABLE pedido_itens (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          variedade_id INTEGER REFERENCES variedades(id) ON DELETE SET NULL,
          produto_nome TEXT NOT NULL,
          variedade_nome TEXT NOT NULL DEFAULT '',
          unidade TEXT NOT NULL DEFAULT 'un',
          quantidade INTEGER NOT NULL DEFAULT 1,
          preco_unitario REAL NOT NULL DEFAULT 0
        )`
      );
      console.log('🔄 pedidos migrado para multi-itens (tabela recriada)');
    }
  } catch (e) {
    console.warn('migração opcional ignorada:', e.message);
  }
}

/* ---------------- helpers ---------------- */
async function getSetting(chave, padrao = '') {
  const r = await pool.query('SELECT valor FROM settings WHERE chave = $1', [chave]);
  return r.rows.length ? r.rows[0].valor : padrao;
}
async function setSetting(chave, valor) {
  await pool.query(
    'INSERT INTO settings (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor',
    [chave, String(valor)]
  );
}

/* ---- senha ---- */
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
async function senhaDefinida() {
  return !!(await getSetting('senha_hash', ''));
}
async function definirSenha(senha) {
  if (!senha || String(senha).length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres');
  await setSetting('senha_hash', hashSenha(String(senha)));
}

/* ---- sessões ---- */
async function criarSessao() {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO sessoes (token, expira_em) VALUES ($1, to_char(now() + interval '12 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS.000\"Z\"'))",
    [token]
  );
  return token;
}
async function validarSessao(token) {
  if (!token) return false;
  const r = await pool.query('SELECT expira_em FROM sessoes WHERE token = $1', [token]);
  if (!r.rows.length) return false;
  if (new Date(r.rows[0].expira_em).getTime() < Date.now()) {
    await pool.query('DELETE FROM sessoes WHERE token = $1', [token]);
    return false;
  }
  return true;
}
async function destruirSessao(token) {
  if (token) await pool.query('DELETE FROM sessoes WHERE token = $1', [token]);
}

/* ---- categorias ---- */
async function listarCategorias() {
  const r = await pool.query('SELECT * FROM categorias ORDER BY ordem, id');
  return r.rows;
}
async function categoriaPorId(id) {
  const r = await pool.query('SELECT * FROM categorias WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function criarCategoria({ nome, icone, descricao, ordem, ativo }) {
  const r = await pool.query(
    'INSERT INTO categorias (nome, icone, descricao, ordem, ativo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [nome, icone || '🛍️', descricao || '', ordem || 0, ativo === false ? 0 : 1]
  );
  return r.rows[0].id;
}
async function atualizarCategoria(id, { nome, icone, descricao, ordem, ativo }) {
  await pool.query(
    'UPDATE categorias SET nome = $1, icone = $2, descricao = $3, ordem = $4, ativo = $5 WHERE id = $6',
    [nome, icone || '🛍️', descricao || '', ordem || 0, ativo === false ? 0 : 1, id]
  );
}
async function removerCategoria(id) {
  await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
}

/* ---- produtos ---- */
async function listarProdutos() {
  const r = await pool.query(
    'SELECT p.*, c.nome AS categoria_nome FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id ORDER BY p.destaque DESC, p.ordem, p.id'
  );
  return r.rows;
}
async function produtoPorId(id) {
  const r = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function criarProduto({ categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo }) {
  const r = await pool.query(
    'INSERT INTO produtos (categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [categoria_id, nome, descricao || '', Number(preco) || 0, preco_dz === '' || preco_dz == null ? null : Number(preco_dz), destaque ? 1 : 0, ordem || 0, ativo === false ? 0 : 1]
  );
  return r.rows[0].id;
}
async function atualizarProduto(id, { categoria_id, nome, descricao, preco, preco_dz, destaque, ordem, ativo }) {
  await pool.query(
    'UPDATE produtos SET categoria_id = $1, nome = $2, descricao = $3, preco = $4, preco_dz = $5, destaque = $6, ordem = $7, ativo = $8 WHERE id = $9',
    [categoria_id, nome, descricao || '', Number(preco) || 0, preco_dz === '' || preco_dz == null ? null : Number(preco_dz), destaque ? 1 : 0, ordem || 0, ativo === false ? 0 : 1, id]
  );
}
async function removerProduto(id) {
  await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
}

/* ---- fotos ---- */
async function fotosDeProduto(produto_id) {
  const r = await pool.query('SELECT * FROM fotos WHERE produto_id = $1 ORDER BY capa DESC, ordem, id', [produto_id]);
  return r.rows;
}
async function fotoPorId(id) {
  const r = await pool.query('SELECT * FROM fotos WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function adicionarFoto(produto_id, url, capa = false) {
  const r = await pool.query(
    'INSERT INTO fotos (produto_id, url, capa) VALUES ($1, $2, $3) RETURNING id',
    [produto_id, url, capa ? 1 : 0]
  );
  if (capa) await pool.query('UPDATE fotos SET capa = 0 WHERE produto_id = $1 AND id != $2', [produto_id, r.rows[0].id]);
  return r.rows[0].id;
}
async function definirCapa(id, produto_id) {
  await pool.query('UPDATE fotos SET capa = 0 WHERE produto_id = $1', [produto_id]);
  await pool.query('UPDATE fotos SET capa = 1 WHERE id = $1', [id]);
}
async function removerFoto(id) {
  const r = await pool.query('SELECT * FROM fotos WHERE id = $1', [id]);
  if (r.rows.length) await pool.query('DELETE FROM fotos WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/* ---- variedades ---- */
async function variedadesDeProduto(produto_id) {
  const r = await pool.query('SELECT * FROM variedades WHERE produto_id = $1 ORDER BY ordem, id', [produto_id]);
  return r.rows;
}
async function variedadePorId(id) {
  const r = await pool.query('SELECT * FROM variedades WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function criarVariedade({ produto_id, nome, preco, estoque, ordem, ativo }) {
  const r = await pool.query(
    'INSERT INTO variedades (produto_id, nome, preco, estoque, ordem, ativo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [produto_id, nome, preco === '' || preco == null ? null : Number(preco), estoque === '' || estoque == null ? null : Number(estoque), ordem || 0, ativo === false ? 0 : 1]
  );
  return r.rows[0].id;
}
async function atualizarVariedade(id, { nome, preco, estoque, ordem, ativo }) {
  await pool.query(
    'UPDATE variedades SET nome = $1, preco = $2, estoque = $3, ordem = $4, ativo = $5 WHERE id = $6',
    [nome, preco === '' || preco == null ? null : Number(preco), estoque === '' || estoque == null ? null : Number(estoque), ordem || 0, ativo === false ? 0 : 1, id]
  );
}
async function removerVariedade(id) {
  await pool.query('DELETE FROM variedades WHERE id = $1', [id]);
}

/* ---- pedidos (multi-itens) ---- */
async function criarPedido({ itens, nome, whatsapp, observacao, dispositivo, pdf_url }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'INSERT INTO pedidos (nome, whatsapp, observacao, dispositivo, pdf_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nome || '', whatsapp || '', observacao || '', dispositivo || '', pdf_url || '']
    );
    const pedidoId = r.rows[0].id;
    for (const it of itens || []) {
      await client.query(
        'INSERT INTO pedido_itens (pedido_id, produto_id, variedade_id, produto_nome, variedade_nome, unidade, quantidade, preco_unitario) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [pedidoId, it.produto_id, it.variedade_id || null, it.produto_nome || '', it.variedade_nome || '', it.unidade || 'un', Number(it.quantidade) || 1, Number(it.preco_unitario) || 0]
      );
    }
    await client.query('COMMIT');
    return pedidoId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function itensDoPedido(pedido_id) {
  const r = await pool.query('SELECT * FROM pedido_itens WHERE pedido_id = $1 ORDER BY id', [pedido_id]);
  return r.rows;
}
async function listarPedidos(status) {
  const r = status
    ? await pool.query('SELECT * FROM pedidos WHERE status = $1 ORDER BY criado_em DESC', [status])
    : await pool.query('SELECT * FROM pedidos ORDER BY criado_em DESC');
  for (const ped of r.rows) ped.itens = await itensDoPedido(ped.id);
  return r.rows;
}
async function atualizarStatusPedido(id, status) {
  await pool.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);
}
async function setPdfUrlPedido(id, pdf_url) {
  await pool.query('UPDATE pedidos SET pdf_url = $1 WHERE id = $2', [pdf_url || '', id]);
}

/* ---- catálogo público ---- */
async function catalogoCompleto() {
  const cats = (await pool.query('SELECT * FROM categorias WHERE ativo = 1 ORDER BY ordem, id')).rows;
  const prods = (await pool.query('SELECT * FROM produtos WHERE ativo = 1 ORDER BY destaque DESC, ordem, id')).rows;
  const fotos = (await pool.query('SELECT * FROM fotos')).rows;
  const vars = (await pool.query('SELECT * FROM variedades WHERE ativo = 1')).rows;
  const fotoDe = new Map();
  for (const f of fotos) {
    if (!fotoDe.has(f.produto_id)) fotoDe.set(f.produto_id, []);
    fotoDe.get(f.produto_id).push(f.url);
  }
  const varDe = new Map();
  for (const v of vars) {
    if (!varDe.has(v.produto_id)) varDe.set(v.produto_id, []);
    varDe.get(v.produto_id).push({ id: v.id, nome: v.nome, preco: v.preco, estoque: v.estoque });
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

/* ---- configurações ---- */
function configPadrao() {
  return {
    titulo: process.env.SITE_TITULO || 'Catálogo Algo+',
    descricao: process.env.SITE_DESCRICAO || 'Impressão 3D sob medida: decoração, personalizados e utilidades.',
    tema: process.env.TEMA || 'claro',
    fundo_tipo: process.env.FUNDO_TIPO || 'cor',
    fundo_valor: process.env.FUNDO_VALOR || '#F5F1EA',
    contato_whatsapp: process.env.CONTATO_WHATSAPP || '',
    contato_email: process.env.CONTATO_EMAIL || '',
    pedido_personalizado: (process.env.PEDIDO_PERSONALIZADO || '1') === '1',
    nota_rodape: process.env.NOTA_RODAPE || '',
  };
}
async function getConfigCompleta() {
  const cfg = configPadrao();
  for (const k of Object.keys(cfg)) cfg[k] = await getSetting('cfg_' + k, cfg[k]);
  return cfg;
}
async function setConfigParcial(patch) {
  const cfg = configPadrao();
  for (const k of Object.keys(cfg)) {
    if (patch[k] !== undefined) await setSetting('cfg_' + k, patch[k]);
  }
}

/* ---- painel ---- */
async function dashboard() {
  const q = async (sql, params) => Number((await pool.query(sql, params)).rows[0].c);
  return {
    categorias: await q('SELECT COUNT(*) c FROM categorias'),
    produtos: await q('SELECT COUNT(*) c FROM produtos'),
    fotos: await q('SELECT COUNT(*) c FROM fotos'),
    variedades: await q('SELECT COUNT(*) c FROM variedades'),
    pedidos_novos: await q("SELECT COUNT(*) c FROM pedidos WHERE status = 'novo'"),
    pedidos_total: await q('SELECT COUNT(*) c FROM pedidos'),
    produtos_inativos: await q('SELECT COUNT(*) c FROM produtos WHERE ativo = 0'),
  };
}

module.exports = {
  DATA_DIR, pool, inicializar,
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