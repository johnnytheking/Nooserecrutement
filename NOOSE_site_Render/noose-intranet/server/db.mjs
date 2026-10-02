import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { questions, training } from './defaults.mjs';
const scrypt = promisify(scryptCb);
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export async function openDatabase() {
  const production = process.env.NODE_ENV === 'production';
  let driver;
  let query;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    driver = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 });
    query = async (sql, args = []) => (await driver.query(sql, args)).rows;
  } else {
    if (production) throw new Error('DATABASE_URL est obligatoire en production pour conserver les dossiers et documents.');
    const { DatabaseSync } = await import('node:sqlite');
    const filename = process.env.SQLITE_PATH || resolve('.data/noose.sqlite');
    mkdirSync(dirname(filename), { recursive: true });
    driver = new DatabaseSync(filename);
    driver.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    query = async (sql, args = []) => {
      const bound = [];
      const statement = driver.prepare(sql.replace(/\$(\d+)/g, (_, n) => { bound.push(args[Number(n) - 1]); return '?'; }));
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql)) return statement.all(...bound);
      statement.run(...bound); return [];
    };
  }
  const binaryType = process.env.DATABASE_URL ? 'BYTEA' : 'BLOB';
  const schema = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','recruteur','formateur')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL, birth_date TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', discord TEXT NOT NULL DEFAULT '', matricule TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', recruited_at TEXT NOT NULL DEFAULT '', recruiter TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'a_examiner', notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, title TEXT NOT NULL, expected TEXT NOT NULL, position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS interviews (candidate_id TEXT PRIMARY KEY REFERENCES candidates(id), answers TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS training (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, recurring INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id), training_id TEXT NOT NULL REFERENCES training(id), status TEXT NOT NULL, evaluated_at TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id), category TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, content ${binaryType} NOT NULL, status TEXT NOT NULL DEFAULT 'en_attente', comment TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id), author_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS idx_evaluations_candidate_created ON evaluations(candidate_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_documents_candidate ON documents(candidate_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_candidate_created ON audit(candidate_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'
  ];
  for (const sql of schema) await query(sql);
  if (!(await query('SELECT id FROM users LIMIT 1')).length) {
    const password = process.env.ADMIN_PASSWORD || (!production ? '1970' : '');
    if (!password) throw new Error('ADMIN_PASSWORD est requis pour le premier démarrage.');
    await query('INSERT INTO users(id,username,name,role,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(username) DO NOTHING', [id(),'admin','Administration NOOSE','admin',await hashPassword(password),now()]);
  }
  if (!(await query('SELECT id FROM questions LIMIT 1')).length) {
    for (let n=0;n<questions.length;n++) await query('INSERT INTO questions(id,title,expected,position) VALUES($1,$2,$3,$4)',[id(),...questions[n],n]);
  }
  if (!(await query('SELECT id FROM training LIMIT 1')).length) {
    for (let n=0;n<training.length;n++) await query('INSERT INTO training(id,title,category,recurring,description,position) VALUES($1,$2,$3,$4,$5,$6)',[id(),...training[n],n]);
  }
  return { query, close: () => process.env.DATABASE_URL ? driver.end() : driver.close() };
}
