'use strict';
/* ============================================================
 * CATALOGO ALGO+ — armazenamento de arquivos
 *   S3_ENDPOINT definido    -> MinIO/S3 (bucket)
 *   sem S3_ENDPOINT         -> disco local (DATA_DIR/uploads)
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'dados');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const s3Ativo = () => !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);

let cliente = null;
function s3Client() {
  if (!cliente) {
    cliente = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
    });
  }
  return cliente;
}

/* Garante que o bucket existe (cria se faltar) — roda no boot quando S3 ativo. */
async function garantirBucket() {
  if (!s3Ativo()) return false;
  try {
    await s3Client().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: '__probe__' }));
    return true;
  } catch (e) {
    if (e && e.name === 'NotFound') return true; // bucket existe, objeto não
    if (e && (e.name === 'NoSuchBucket' || e.name === '404' || e.$metadata && e.$metadata.httpStatusCode === 404)) {
      try {
        await s3Client().send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
        console.log('Bucket criado: ' + process.env.S3_BUCKET);
        return true;
      } catch (e2) {
        console.warn('Nao foi possivel criar o bucket: ' + e2.message);
        return false;
      }
    }
    return true; // outros erros de permissao: segue e tenta no upload
  }
}

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.txt': 'text/plain',
  '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
};
function mimeDe(nome) {
  return MIME[path.extname(nome || '').toLowerCase()] || 'application/octet-stream';
}

/* Gera nome unico e grava (disco ou S3). Retorna o nome do arquivo. */
async function salvar(buffer, nomeOriginal) {
  const nome = crypto.randomBytes(12).toString('hex') + path.extname(nomeOriginal || '').toLowerCase().slice(0, 10);
  if (s3Ativo()) {
    await s3Client().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: nome,
      Body: buffer,
      ContentType: mimeDe(nome),
    }));
  } else {
    fs.writeFileSync(path.join(UPLOAD_DIR, nome), buffer);
  }
  return nome;
}

/* Remove arquivo (disco ou S3). */
async function remover(nome) {
  if (!nome) return;
  if (s3Ativo()) {
    try { await s3Client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: nome })); } catch { /* ignora */ }
  } else {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, nome)); } catch { /* ignora */ }
  }
}

/* Serve o arquivo no GET /arquivos/:nome (resposta streaming). */
async function servir(req, res, nome) {
  if (!nome || nome.includes('/') || nome.includes('..')) {
    return res.status(404).json({ erro: 'Nao encontrado' });
  }
  if (s3Ativo()) {
    try {
      const out = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: nome }));
      res.setHeader('Content-Type', out.ContentType || mimeDe(nome));
      res.setHeader('Content-Length', out.ContentLength || '');
      out.Body.pipe(res);
    } catch (e) {
      res.status(404).json({ erro: 'Nao encontrado' });
    }
    return;
  }
  const p = path.join(UPLOAD_DIR, nome);
  if (!fs.existsSync(p)) return res.status(404).json({ erro: 'Nao encontrado' });
  res.setHeader('Content-Type', mimeDe(nome));
  fs.createReadStream(p).pipe(res);
}

module.exports = { s3Ativo, garantirBucket, salvar, remover, servir, UPLOAD_DIR, TMP_DIR, mimeDe };
