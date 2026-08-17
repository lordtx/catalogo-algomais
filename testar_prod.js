'use strict';
/* Teste integração Catálogo Algo+ → Postgres (banco catalogo_algomais) + MinIO (bucket catalogo-algomais) da VPS.
 * Uso: node testar_prod.js  (lê credenciais de /tmp/canivete_envs.json) */
const fs = require('fs');

const envs = JSON.parse(fs.readFileSync('/tmp/canivete_envs.json', 'utf8'));
// monta URL do banco separado (mesma credencial, banco catalogo_algomais) ANTES do require
const url = new URL(envs.DATABASE_URL);
url.pathname = '/catalogo_algomais';
process.env.DATABASE_URL = url.toString();

const dbm = require('./db-pg');

(async () => {

  await dbm.inicializar();
  console.log('✔ Schema criado no banco catalogo_algomais (tabelas:',
    ['settings','sessoes','categorias','produtos','fotos','variedades','pedidos'].join(','), ')');

  // cria categoria + produto de teste via driver PG
  const catId = await dbm.criarCategoria({ nome: 'Teste PG', icone: '🧪', descricao: 'validacao', ordem: 99, ativo: true });
  const prodId = await dbm.criarProduto({ categoria_id: catId, nome: 'Produto Teste PG', descricao: '', preco: 12.34, destaque: false, ordem: 0, ativo: true });
  const varId = await dbm.criarVariedade({ produto_id: prodId, nome: 'V1', preco: 10, estoque: 5, ordem: 0, ativo: true });
  console.log('✔ Criados: categoria', catId, '| produto', prodId, '| variedade', varId);

  // catálogo público
  const catalogo = await dbm.catalogoCompleto();
  console.log('✔ Catálogo público:', catalogo.length, 'categorias,', catalogo.reduce((a,c)=>a+c.produtos.length,0), 'produtos');

  // pedido
  const pedId = await dbm.criarPedido({ produto_id: prodId, variedade_id: varId, nome: 'QA PG', whatsapp: '5535', quantidade: 1, observacao: '', dispositivo: 'teste' });
  console.log('✔ Pedido criado:', pedId);

  // dashboard
  console.log('✔ Dashboard:', JSON.stringify(await dbm.dashboard()));

  // limpa
  await dbm.removerProduto(prodId);
  await dbm.removerCategoria(catId);
  console.log('✔ Limpeza ok — banco separado funcional.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });