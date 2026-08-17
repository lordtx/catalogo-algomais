'use strict';
/* Diagnóstico: lista bancos e cria banco separado do catálogo no Postgres da VPS */
const { Client } = require('pg');

const URL = process.argv[2]; // connection string
const NOVO_BANCO = 'catalogo_algomais';

(async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();
  const r = await c.query('SELECT datname FROM pg_database ORDER BY datname');
  const bancos = r.rows.map(x => x.datname);
  console.log('Bancos existentes:', bancos.join(', '));
  if (!bancos.includes(NOVO_BANCO)) {
    await c.query(`CREATE DATABASE ${NOVO_BANCO}`);
    console.log('✔ Banco criado:', NOVO_BANCO);
  } else {
    console.log('Banco já existe:', NOVO_BANCO);
  }
  await c.end();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });