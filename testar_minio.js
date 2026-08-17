'use strict';
/* Teste storage → MinIO real da VPS (bucket catalogo-algomais). */
const fs = require('fs');
const envs = JSON.parse(fs.readFileSync('/tmp/canivete_envs.json', 'utf8'));

process.env.S3_ENDPOINT = 'http://187.127.48.130:9000'; // IP público p/ teste local
process.env.S3_BUCKET = 'catalogo-algomais';
process.env.S3_ACCESS_KEY = envs.S3_ACCESS_KEY;
process.env.S3_SECRET_KEY = envs.S3_SECRET_KEY;
process.env.S3_REGION = envs.S3_REGION || 'us-east-1';

const storage = require('./storage');
const http = require('http');

(async () => {
  console.log('s3Ativo:', storage.s3Ativo());
  // salva um arquivo de teste
  const nome = await storage.salvar(Buffer.from('teste-minio-catalogo-algomais'), 'teste.txt');
  console.log('✔ salvo:', nome);
  // serve via requisição HTTP simulada
  const req = { headers: {} };
  const res = new (class { constructor(){ this.status=0; this.headers={}; } setHeader(k,v){ this.headers[k]=v; } status(status){ this.status=status; return this; } json(o){ this.body=JSON.stringify(o); } pipe(){ this.pipeCalled=true; } })();
  await storage.servir(req, res, nome);
  // lê direto do bucket pra confirmar o conteúdo
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  });
  const out = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: nome }));
  const chunks = [];
  for await (const c of out.Body) chunks.push(c);
  const texto = Buffer.concat(chunks).toString();
  console.log('✔ conteúdo no bucket:', texto);
  // remove
  await storage.remover(nome);
  console.log('✔ removido');
  console.log('TESTE MINIO OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });