// pdf_extractor.js
// Handles sending PDF files to the backend for BL/payment extraction
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Sends a PDF file to the backend extraction endpoint and returns extracted fields.
 * @param {string} filePath - Local path to the PDF file
 * @returns {Promise<{bl_numbers: string[], paid_amount: number|null, raw_text?: string}>}
 */
async function extractFieldsFromPDF(filePath) {
  const backendUrl = process.env.PDF_EXTRACTION_URL || `${process.env.FRONTEND_URL || 'https://iqstrade.onrender.com'}/process_pdf`;
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    const headers = formData.getHeaders();
    const response = await axios.post(backendUrl, formData, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    return response.data;
  } catch (err) {
    console.error('[PDF Extractor] Error extracting fields from PDF:', err);
    return { bl_numbers: [], paid_amount: null };
  }
}

module.exports = { extractFieldsFromPDF };
