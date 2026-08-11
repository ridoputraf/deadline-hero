const { Pool } = require('pg');
require('dotenv').config();

let pool;

function initPool() {
  const connectionString = process.env.DATABASE_URL || process.env.DB_CONNECT_STRING;

  const config = connectionString
    ? {
        connectionString,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: { rejectUnauthorized: false }
      };

  pool = new Pool(config);

  return pool.connect().then(client => {
    client.release();
    return pool;
  }).catch(err => {
    console.error('DB POOL CREATE ERROR:', err.message);
    throw err;
  });
}

function getPool() {
  return pool;
}

async function getConnection() {
  if (!pool) {
    throw new Error('Database pool belum diinisialisasi');
  }
  return await pool.connect();
}

async function closePool() {
  if (pool) {
    await pool.end();
  }
}

function sanitizeError(err) {
  if (!err) return { message: 'Unknown error' };
  return {
    message: err.message || 'Database error',
    errorNum: err.code || 'UNKNOWN'
  };
}

module.exports = {
  initPool,
  getPool,
  getConnection,
  closePool,
  sanitizeError
};