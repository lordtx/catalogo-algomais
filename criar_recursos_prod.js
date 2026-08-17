'use strict';
/* Cria recursos separados do Catálogo Algo+ no Postgres e MinIO da VPS.
 * Lê /tmp/canivete_envs.json (envs reais do Canivete) para reusar credenciais. */
const fs = require('fs');
const { Client } = require('pg');
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const envs = JSON.parse(fs.readFileSync('/tmp/canivete_envs.json', 'utf8'));

const NOVO_BANCO = 'catalogo_algomais';
const NOVO_BUCKET = 'catalogo-algomais';

(async () => {
  // ---------- Postgres: cria banco separado ----------
  const client = new Client({ connectionString: envs.DATABASE_URL });
  await client.connect();
  const r = await client.query('SELECT datname FROM pg_database ORDER BY datname');
  const bancos = r.rows.map(x => x.datname);
  console.log('Bancos existentes:', bancos.join(', '));
  if (!bancos.includes(NOVO_BANCO)) {
    await client.query(`CREATE DATABASE ${NOVO_BANCO}`);
    console.log('✔ Banco criado:', NOVO_BANCO);
  } else {
    console.log('Banco já existe:', NOVO_BANCO);
  }
  await client.end();

  // ---------- MinIO: verifica/cria bucket separado ----------
  // Usa IP público aqui (nameserver 'minio' só resolve dentro da rede Docker do Coolify)
  const s3 = new S3Client({
    endpoint: (envs.S3_ENDPOINT || '').includes('minio')
      ? 'http://187.127.48.130:9000'
      : envs.S3_ENDPOINT,
    region: envs.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: envs.S3_ACCESS_KEY, secretAccessKey: envs.S3_SECRET_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: NOVO_BUCKET }));
    console.log('Bucket já existe:', NOVO_BUCKET);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: NOVO_BUCKET }));
    console.log('✔ Bucket criado:', NOVO_BUCKET);
  }
  console.log('✔ Recursos do Catálogo Algo+ prontos: banco + bucket separados.');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });