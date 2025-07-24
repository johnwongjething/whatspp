const { Pool } = require('pg');
require('dotenv').config();
const { logMessage } = require('./logger');

const pool = new Pool({
  host: process.env.RAILWAY_DB_HOST,
  user: process.env.RAILWAY_DB_USER,
  password: process.env.RAILWAY_DB_PASSWORD,
  database: process.env.RAILWAY_DB_NAME,
  port: process.env.RAILWAY_DB_PORT,
  ssl: false,
});

async function getInvoiceLink(blNumber) {
  logMessage('DB_QUERY', { type: 'getInvoiceLink', blNumber });
  try {
    const res = await pool.query(
      'SELECT invoice_filename FROM bill_of_lading WHERE TRIM(LOWER(bl_number)) = LOWER($1)',
      [blNumber.trim()]
    );
    console.log('[DEBUG] getInvoiceLink DB rows for', blNumber, ':', JSON.stringify(res.rows));
    return res.rows;
  } catch (err) {
    console.error('DB error in getInvoiceLink:', err);
    return null;
  }
}

async function getUniqueNumber(blNumber) {
  logMessage('DB_QUERY', { type: 'getUniqueNumber', blNumber });
  try {
    const res = await pool.query(
      'SELECT unique_number FROM bill_of_lading WHERE TRIM(LOWER(bl_number)) = LOWER($1)',
      [blNumber.trim()]
    );
    console.log('[DEBUG] getUniqueNumber DB rows for', blNumber, ':', JSON.stringify(res.rows));
    return res.rows[0]?.unique_number;
  } catch (err) {
    console.error('DB error in getUniqueNumber:', err);
    return null;
  }
}

// Returns only BLs that exist in the DB (for multi-BL validation)
async function getValidBLs(blNumbers) {
  if (!Array.isArray(blNumbers) || blNumbers.length === 0) return [];
  try {
    const res = await pool.query(
      `SELECT bl_number FROM bill_of_lading WHERE bl_number = ANY($1)`,
      [blNumbers]
    );
    return res.rows.map(r => r.bl_number);
  } catch (err) {
    console.error('DB error in getValidBLs:', err);
    return [];
  }
}

// Returns invoice info for BLs (like find_invoice_info in backend)
async function getInvoiceInfo(blNumbers) {
  if (!Array.isArray(blNumbers) || blNumbers.length === 0) return [];
  try {
    const res = await pool.query(
      `SELECT bl_number, invoice_filename, customer_name, service_fee, ctn_fee, payment_link
       FROM bill_of_lading WHERE bl_number = ANY($1)`,
      [blNumbers]
    );
    return res.rows;
  } catch (err) {
    console.error('DB error in getInvoiceInfo:', err);
    return [];
  }
}

// Returns payment status for a BL
async function getPaymentStatus(blNumber) {
  logMessage('DB_QUERY', { type: 'getPaymentStatus', blNumber });
  try {
    const res = await pool.query(
      'SELECT status FROM bill_of_lading WHERE TRIM(LOWER(bl_number)) = LOWER($1)',
      [blNumber.trim()]
    );
    return res.rows[0]?.status || null;
  } catch (err) {
    console.error('DB error in getPaymentStatus:', err);
    return null;
  }
}

module.exports = { pool, getInvoiceLink, getUniqueNumber, getValidBLs, getInvoiceInfo, getPaymentStatus };
