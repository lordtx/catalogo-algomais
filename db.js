'use strict';
/* ============================================================
 * CATÁLOGO VIRTUAL — seleção do banco de dados
 *   DATABASE_URL definido  → PostgreSQL (db-pg.js, async)
 *   sem DATABASE_URL       → SQLite (db-sqlite.js, padrão)
 * ============================================================ */
if (process.env.DATABASE_URL) {
  module.exports = require('./db-pg');
} else {
  module.exports = require('./db-sqlite');
}