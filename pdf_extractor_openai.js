// Direct PDF field extraction using pdf-parse and OpenAI
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Extracts BL numbers and paid amount from a PDF using OpenAI GPT-4o.
 * @param {string} filePath - Local path to the PDF file
 * @returns {Promise<{bl_numbers: string[], paid_amount: number|null, raw_text?: string}>}
 */
async function extractFieldsFromPDF(filePath) {
  let rawText = '';
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    rawText = pdfData.text;

    // Debug: log the extracted PDF text (first 500 chars)
    console.log('[PDF Extractor] Extracted PDF text:', rawText.slice(0, 500));

    // Improved prompt for OpenAI
    const prompt = `Extract all Bill of Lading numbers (BL numbers, e.g. NYC22062889, BL12345, NYC220, or similar) and the payment amount (in USD or other currencies) from the following receipt text.\n\nText:\n"""${rawText}\n"""\n\nReturn a JSON object with keys: bl_numbers (array of strings), paid_amount (number or null). If nothing is found, return empty array and null. Only return the JSON.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a document parser for logistics and shipping receipts.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0
    });
    let result;
    try {
      // Try to parse JSON from OpenAI response
      const text = completion.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // If OpenAI did not return bl_numbers or paid_amount, use regex fallback
        if (!('bl_numbers' in parsed) || !('paid_amount' in parsed)) {
          result = extractFieldsWithRegex(rawText);
        } else {
          result = {
            bl_numbers: parsed.bl_numbers || [],
            paid_amount: parsed.paid_amount || null,
            raw_text: rawText
          };
        }
      } else {
        // Fallback to regex extraction
        result = extractFieldsWithRegex(rawText);
      }
    } catch (e) {
      // Fallback to regex extraction
      result = extractFieldsWithRegex(rawText);
    }
    return result;
  } catch (err) {
    console.error('[PDF Extractor] Error extracting fields from PDF:', err);
    return extractFieldsWithRegex(rawText);
  }
}

// Regex fallback for BL numbers and paid amount
function extractFieldsWithRegex(text) {
  // BL number patterns: NYC22062889, BL12345, 001-123, NYC220, etc.
  const blRegexes = [
    /\b[A-Z]{3}\d{6,}\b/g, // e.g. NYC22062889
    /\bBL[ -]?\d{4,}\b/gi, // e.g. BL12345
    /\b\d{3}-\d{3,}\b/g, // e.g. 001-123
    /\b[A-Z]{3,}\d{0,}\b/g // e.g. NYC220 (short BLs)
  ];
  let bl_numbers = [];
  for (const regex of blRegexes) {
    const found = text.match(regex);
    if (found) bl_numbers = bl_numbers.concat(found.map(s => s.toUpperCase()));
  }
  bl_numbers = Array.from(new Set(bl_numbers));

  // Payment amount: $400, USD 400, etc.
  let paid_amount = null;
  const amountMatch = text.match(/\$\s?(\d+[.,]?\d*)|USD\s?(\d+[.,]?\d*)/i);
  if (amountMatch) {
    paid_amount = parseFloat(amountMatch[1] || amountMatch[2]);
  }

  return { bl_numbers, paid_amount, raw_text: text };
}

module.exports = { extractFieldsFromPDF };
