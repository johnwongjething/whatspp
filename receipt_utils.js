// Utility for generating and uploading receipts, and updating BL status
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { pool } = require('./db');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

async function generateReceiptPDF({ blNumbers, paidAmount, invoiceDetails, customerName }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const filename = `receipt_${blNumbers.join('_')}_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, 'temp', filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).text('Payment Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Customer: ${customerName || ''}`);
    doc.text(`BL Number(s): ${blNumbers.join(', ')}`);
    doc.text(`Paid Amount: $${paidAmount}`);
    doc.moveDown();
    doc.text('Invoice Details:');
    invoiceDetails.forEach(line => doc.text(line));
    doc.moveDown();
    doc.text('Thank you for your payment!');
    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

async function uploadReceiptToCloudinary(filePath) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, { folder: 'receipts', resource_type: 'raw' }, (err, result) => {
      if (err) return reject(err);
      resolve(result.secure_url);
    });
  });
}


async function updateBLStatusAndReceipt(blNumbers, receiptUrl) {
  const client = await pool.connect();
  const results = [];
  try {
    for (const bl of blNumbers) {
      const res = await client.query(
        `UPDATE bill_of_lading SET receipt_filename = $1, status = 'Awaiting Bank In', receipt_uploaded_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Hong_Kong') WHERE bl_number = $2 RETURNING bl_number, status, receipt_filename, receipt_uploaded_at`,
        [receiptUrl, bl]
      );
      results.push({ bl, result: res.rows[0] });
    }
    return results;
  } finally {
    client.release();
  }
}

module.exports = { generateReceiptPDF, uploadReceiptToCloudinary, updateBLStatusAndReceipt };
