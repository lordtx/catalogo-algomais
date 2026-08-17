'use strict';
/* Seed de teste — popula categorias, produtos, fotos e variedades (SQLite local).
 * Uso: DATA_DIR=./dados node seed.js  */
const path = require('path');
const fs = require('fs');
const dbm = require('./db-sqlite');

const FOTO_SVG = (cor, letra) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${cor}"/><text x="300" y="330" font-size="220" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${letra}</text></svg>`
);

async function salvarFoto(letra, cor) {
  const nome = 'seed-' + letra.toLowerCase() + '-' + cor.replace('#', '') + '.svg';
  fs.writeFileSync(path.join(dbm.UPLOAD_DIR, nome), FOTO_SVG(cor, letra));
  return '/arquivos/' + nome;
}

(async () => {
  // só popula se estiver vazio
  if (dbm.listarCategorias().length) {
    console.log('Base já tem dados — nada a fazer.');
    return;
  }

  const decoracao = dbm.criarCategoria({ nome: 'Decoração', icone: '🏺', descricao: 'Vasos, luminárias e objetos para a casa', ordem: 1 });
  const personalizados = dbm.criarCategoria({ nome: 'Personalizados', icone: '🎁', descricao: 'Canecas, chaveiros, plaquinhas e presentes', ordem: 2 });
  const utilidades = dbm.criarCategoria({ nome: 'Utilidades', icone: '🔧', descricao: 'Suportes, organizadores e acessórios úteis', ordem: 3 });
  const acessorios = dbm.criarCategoria({ nome: 'Acessórios', icone: '👓', descricao: 'Para celular, fone e gadgets', ordem: 4 });

  async function prod(categoria_id, nome, descricao, preco, destaque, fotos, variedades, preco_dz) {
    const id = dbm.criarProduto({ categoria_id, nome, descricao, preco, preco_dz, destaque });
    for (const [i, f] of fotos.entries()) {
      const url = await salvarFoto(f, ['#0f766e', '#f59e0b', '#7c3aed', '#dc2626', '#2563eb'][i % 5]);
      dbm.adicionarFoto(id, url, i === 0);
    }
    for (const v of variedades) dbm.criarVariedade({ produto_id: id, ...v });
    return id;
  }

  await prod(decoracao, 'Vaso Espiral Moderno', 'Vaso decorativo em PLA com acabamento fosco. Ideal para suculentas e cactos.', 59.90, 1,
    ['V', 'E'],
    [
      { nome: 'Branco', preco: 59.90, estoque: 8 },
      { nome: 'Preto', preco: 59.90, estoque: 6 },
      { nome: 'Verde Menta', preco: 64.90, estoque: 4 },
    ]);

  await prod(decoracao, 'Luminária Geométrica', 'Luminária de mesa com padrão geométrico vazado. Base para vela ou luz LED.', 89.90, 1,
    ['L', 'G'],
    [
      { nome: 'Branca', preco: 89.90, estoque: 5 },
      { nome: 'Âmbar', preco: 94.90, estoque: 3 },
    ]);

  await prod(decoracao, 'Suporte de Parede Galho', 'Suporte decorativo de parede em formato de galho, com 3 ganchos.', 45.90, 0,
    ['G'],
    [
      { nome: 'Preto', preco: 45.90, estoque: 10 },
      { nome: 'Carvalho', preco: 49.90, estoque: 7 },
    ]);

  await prod(personalizados, 'Caneca Personalizada', 'Caneca térmica com nome, logo ou frase gravados em 3D. Material atóxico.', 49.90, 1,
    ['C'],
    [
      { nome: 'Branca', preco: 49.90, estoque: 12 },
      { nome: 'Preta', preco: 54.90, estoque: 9 },
      { nome: 'Vermelha', preco: 54.90, estoque: 6 },
    ]);

  await prod(personalizados, 'Chaveiro Nome', 'Chaveiro personalizado com nome em alto relevo. Acompanha argola.', 19.90, 0,
    ['K'],
    [
      { nome: 'PLA colorido', preco: 19.90, estoque: 20 },
      { nome: 'Glow (fosforescente)', preco: 24.90, estoque: 8 },
    ],
    179.00);

  await prod(personalizados, 'Plaquinha de Parede', 'Plaquinha decorativa com frase, logo ou desenho. Vários tamanhos.', 69.90, 0,
    ['P'],
    [
      { nome: '15 cm', preco: 49.90, estoque: 10 },
      { nome: '25 cm', preco: 69.90, estoque: 8 },
      { nome: '40 cm', preco: 99.90, estoque: 5 },
    ]);

  await prod(utilidades, 'Suporte de Celular Articulado', 'Suporte de mesa com braço articulado, compatível com celulares até 6,9".', 39.90, 1,
    ['S'],
    [
      { nome: 'Preto', preco: 39.90, estoque: 15 },
      { nome: 'Cinza', preco: 39.90, estoque: 11 },
    ]);

  await prod(utilidades, 'Organizador de Mesa', 'Bandeja organizadora com divisórias para canetas, clipes e acessórios.', 34.90, 0,
    ['O'],
    [
      { nome: 'Cinza', preco: 34.90, estoque: 13 },
      { nome: 'Preto', preco: 34.90, estoque: 9 },
    ]);

  await prod(acessorios, 'Suporte de Fone', 'Suporte de mesa para headset com encaixe confortável e base estável.', 29.90, 0,
    ['F'],
    [
      { nome: 'Preto', preco: 29.90, estoque: 14 },
      { nome: 'Branco', preco: 29.90, estoque: 10 },
    ]);

  await prod(acessorios, 'Cabo Organizer Três Vias', 'Organizador de cabos para mesa, com 3 canais e adesivo 3M.', 24.90, 0,
    ['C', 'O'],
    [
      { nome: 'Pacote c/ 2', preco: 24.90, estoque: 18 },
      { nome: 'Pacote c/ 4', preco: 44.90, estoque: 12 },
    ]);

  console.log('✔ Seed criado: 4 categorias, 10 produtos, fotos SVG e variedades.');
  console.log('→ Login admin: SENHA_ADM ou veja o console do server.');
})().catch(e => { console.error(e); process.exit(1); });