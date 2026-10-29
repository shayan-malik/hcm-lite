import bcrypt from 'bcryptjs';
import pool from '../db.js';

// Creates the first Admin from env variables when the system is still empty
export const seedAdminFromEnv = async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock so two serverless instances cannot seed twice
    await client.query('SELECT pg_advisory_xact_lock(424242)');

    const done = await client.query('SELECT 1 FROM settings WHERE id = 1');
    if (done.rowCount > 0) {
      await client.query('ROLLBACK');
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query('INSERT INTO settings (id, company_name) VALUES (1, $1)', [
      process.env.COMPANY_NAME || 'My Company',
    ]);
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`,
      [email, hash]
    );
    await client.query('COMMIT');
    console.log('First Admin created from environment variables');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin seeding failed:', err.message);
  } finally {
    client.release();
  }
};