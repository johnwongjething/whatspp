const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { getInvoiceLink, getUniqueNumber, getValidBLs, getInvoiceInfo, getPaymentStatus } = require('./db');
const { logMessage } = require('./logger');
const { generateReceiptPDF, uploadReceiptToCloudinary, updateBLStatusAndReceipt } = require('./receipt_utils');
const fetch = require('node-fetch');
const fs = require('fs');

const conversationHistory = {};
const SYSTEM_PROMPT = `You are a logistics assistant. Respond in this JSON format:
{
  "intent": "request_invoice|ask_ctn_number|ask_payment_methods|ask_pricing|general_question|payment_receipt|other|ask_payment_status",
  "bl_number": "<BL number if present from context, else null>",
  "answer": "<Response based on intent and context>"
}
- For 'request_invoice', 'ask_ctn_number', 'ask_payment_status', or 'payment_receipt' with invalid BLs [INVALID_BLS], return 'Sorry, the BL number(s) [INVALID_BLS] could not be found in our system. Please check and try again.'
- For 'general_question', match the query against these phrases and return the corresponding canned response if a partial match is found (e.g., key terms like "ctn" and "processing" for "ctn processing time"):
  - 'ctn processing time' → 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.'
  - 'payment methods' → 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.'
  - 'fees' → 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Contact us for details.'
  - 'how do i get a copy of my invoice' → 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.'
  - 'how do i track the status of my ctn' → 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.'
  - 'what documents do i need to provide for ctn processing' → 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.'
  - 'how do i upload my bank transfer receipt' → 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.'
  - 'can i get a refund or cancel my ctn' → 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.'
  - 'what is the difference between ctn and b l' → 'A Bill of Lading (B/L) is required to initiate CTN processing; a CTN is the note issued to track your cargo documentation status.'
  - 'what are your business hours' → 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.'
  - 'how do i contact support' → 'Contact support by replying here or calling [your phone number]. We’re here to help!'
  - 'can i pay in a different currency' → 'We accept USD only. Contact us in advance to discuss other currency options.'
  - 'how do i update my company contact information' → 'Update your company or contact info by replying with new details or via our online portal.'
  - 'how do i check my payment status' → 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.'
  - 'how do i request urgent processing' → 'For urgent processing, please mention your BL number and the reason for urgency. We will prioritize your request if possible.'
  - If no sufficient match, return 'For general enquiries, please provide your BL number or contact support for assistance.'
- For other intents, provide a relevant response based on the context.
- Context: Valid BLs are [VALID_BLS], invalid BLs are [INVALID_BLS]. Available general enquiry phrases are: ctn processing time, payment methods, fees, how do i get a copy of my invoice, how do i track the status of my ctn, what documents do i need to provide for ctn processing, how do i upload my bank transfer receipt, can i get a refund or cancel my ctn, what is the difference between ctn and b l, what are your business hours, how do i contact support, can i pay in a different currency, how do i update my company contact information, how do i check my payment status, how do i request urgent processing.`;

const CANNED_RESPONSES = {
  'ctn processing time': 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.',
  'payment methods': 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.',
  'fees': 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Contact us for details.',
  'how do i get a copy of my invoice': 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.',
  'how do i track the status of my ctn': 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.',
  'what documents do i need to provide for ctn processing': 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.',
  'how do i upload my bank transfer receipt': 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.',
  'can i get a refund or cancel my ctn': 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.',
  'what is the difference between ctn and b l': 'A Bill of Lading (B/L) is required to initiate CTN processing; a CTN is the note issued to track your cargo documentation status.',
  'what are your business hours': 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.',
  'how do i contact support': 'Contact support by replying here or calling [your phone number]. We’re here to help!',
  'can i pay in a different currency': 'We accept USD only. Contact us in advance to discuss other currency options.',
  'how do i update my company contact information': 'Update your company or contact info by replying with new details or via our online portal.',
  'how do i check my payment status': 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.',
  'how do i request urgent processing': 'For urgent processing, please mention your BL number and the reason for urgency. We will prioritize your request if possible.'
};

function isEmail(str) { return typeof str === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str.trim()); }
function isChinese(text) { if (!text) return false; const chineseChars = Array.from(text).filter(c => /[\u4e00-\u9fff]/.test(c)).length; return chineseChars > 0 && chineseChars / Math.max(1, text.length) > 0.2; }
function extractBLNumbers(text) {
  const blPattern = /(?:提单号[:：]?\s*)?([A-Z]{2,4}\d{2,}|BL-\d{4,}|\d{3,}-\d{3,}|\d{6,}|\d{4,})(?![^@]*@)/gi; // Exclude strings with @
  const extraBLs = text.split(/[,\s]+/).filter(x => /^[A-Z]{2,4}\d{2,}$|^\d{4,}$|^\d{3}-\d{3}$/.test(x) && !x.includes('@')); // Exclude emails
  let matches = [];
  let match;
  while ((match = blPattern.exec(text)) !== null) if (match[1] && !match[1].includes('@')) matches.push(match[1]);
  return Array.from(new Set([...matches, ...extraBLs]));
}
function extractPaymentAmount(text) { if (!text) return null; const patterns = [/\$\s?([0-9]+(?:\.[0-9]{1,2})?)/i, /USD\s*([0-9]+(?:\.[0-9]{1,2})?)/i, /Amount[:：]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i, /Paid[:：]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i]; for (const pat of patterns) { const match = text.match(pat); if (match) try { return parseFloat(match[1]); } catch (e) { continue; } } return null; }

async function callOpenAI(messages) {
  try {
    return await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
    });
  } catch (error) {
    if (error.code === 'rate_limit_exceeded') {
      console.warn('GPT-4o limit hit, falling back to gpt-3.5-turbo...');
      return await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: messages,
      });
    } else {
      throw error;
    }
  }
}

async function openaiTranslate(text, sourceLang, targetLang) {
  try {
    const translationPrompt = `Translate the following ${sourceLang} text to ${targetLang}. Only return the translated text, no explanation.\n\n${text}`;
    const response = await callOpenAI([{ role: 'system', content: 'You are a professional translator.' }, { role: 'user', content: translationPrompt }]);
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error('[OpenAI Translate] Failed:', e);
    return text;
  }
}

async function getIntentAndResponse(message, history, validBLs, invalidBLs) {
  const context = `Valid BLs are ${validBLs.join(', ') || 'none'}, invalid BLs are ${invalidBLs.join(', ') || 'none'}.`;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT.replace('[VALID_BLS]', validBLs.join(', ') || 'none').replace('[INVALID_BLS]', invalidBLs.join(', ') || 'none') }, ...history];
  try {
    const completion = await callOpenAI(messages, { max_tokens: 300 });
    const content = completion.choices[0].message.content.trim();
    let result = {};
    try { result = JSON.parse(content.replace(/```json\n|\n```/g, '')); } catch (e) { result = { intent: 'general_question', bl_number: null, answer: content }; }
    console.log('[OpenAI JSON Response]:', JSON.stringify(result, null, 2));
    return result;
  } catch (e) { console.error('[OpenAI Error]:', e); return { intent: 'general_question', bl_number: null, answer: 'Sorry, an unexpected error occurred.' }; }
}

async function verifySensitiveAccess({ email, bl_number }) {
  try {
    const res = await fetch(`${process.env.FRONTEND_URL || 'https://iqstrade.onrender.com'}/api/verify_sensitive_access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, bl_number })
    });
    const data = await res.json(); // Parse JSON directly
    console.log('[DEBUG] Verification Response:', data); // Log the parsed response
    if (!res.ok) {
      throw new Error(data.message || 'Verification request failed');
    }
    return data;
  } catch (e) {
    console.error('[Verification Error]:', e.message);
    return { success: false, message: e.message || 'Error during verification' };
  }
}

async function chatHandler(message, sender, context = {}) {
  if (context.messages && context.messages[0]?.key?.fromMe) return '';

  if (!conversationHistory[sender]) conversationHistory[sender] = { history: [], session: { verifiedEmail: null, lastSentMsg: null, pendingResponse: null, pendingBLs: [], verificationTimestamp: null, lastValidatedBLs: [] } };
  conversationHistory[sender].history.push({ role: 'user', content: message || '' }); // Ensure message is defined

  const incomingIsChinese = isChinese(message);
  let blNumbers = extractBLNumbers(message || ''); // Extract BL numbers from current message
  console.log('[DEBUG] Extracted BL numbers from message:', blNumbers); // Debug extracted BLs
  let paidAmount = extractPaymentAmount(message) || (context.paid_amount || null);
  let userEmail = conversationHistory[sender].session.verifiedEmail || context.email;
  let justProvidedEmail = isEmail(message) ? message.trim() : null;

  // Prioritize BLs from context if present
  if (context.bl_numbers && !context.skipBLExtraction) {
    blNumbers = Array.from(new Set([...context.bl_numbers, ...blNumbers])); // Context BLs first
    conversationHistory[sender].history = conversationHistory[sender].history.filter(h => !h.content.startsWith('Untitled')); // Clear previous PDF context
  }

  // Store and update last validated BLs only when new BLs are provided and validated
  if (blNumbers.length > 0) {
    const validBLs = await getValidBLs(blNumbers);
    if (validBLs.length > 0) {
      conversationHistory[sender].session.lastValidatedBLs = validBLs; // Update last validated BLs
    }
    blNumbers = validBLs; // Use validated BLs for current request
  } else {
    blNumbers = conversationHistory[sender].session.lastValidatedBLs; // Fallback to last validated BLs
  }

  // Store BLs from the initial request if verification is pending
  if (blNumbers.length > 0 && !conversationHistory[sender].session.verifiedEmail && !justProvidedEmail) {
    conversationHistory[sender].session.pendingBLs = blNumbers;
    // Store the last sensitive user request for replay after verification
    conversationHistory[sender].session.lastSensitiveRequest = message;
    console.log('[DEBUG] Stored pending BLs:', blNumbers);
  } else if (blNumbers.length > 0 && conversationHistory[sender].session.lastSensitiveRequest && !justProvidedEmail) {
    // Update pendingBLs with new BL provided after initial request, excluding email messages
    conversationHistory[sender].session.pendingBLs = Array.from(new Set([...conversationHistory[sender].session.pendingBLs, ...blNumbers]));
    console.log('[DEBUG] Updated pending BLs with new input:', conversationHistory[sender].session.pendingBLs);
  }

  // Determine valid BLs without re-validating existing ones
  let validBLs = blNumbers.length > 0 ? blNumbers : [];
  if (blNumbers.length > 0 && blNumbers.some(bl => !conversationHistory[sender].session.lastValidatedBLs.includes(bl))) {
    const newValidBLs = await getValidBLs(blNumbers);
    validBLs = newValidBLs;
    if (newValidBLs.length > 0) {
      conversationHistory[sender].session.lastValidatedBLs = Array.from(new Set([...conversationHistory[sender].session.lastValidatedBLs, ...newValidBLs]));
    }
  }
  console.log('[DEBUG] Valid BLs from DB:', validBLs); // Debug valid BLs
  const invalidBLs = blNumbers.filter(bl => !validBLs.includes(bl));

  let intent = 'general_question'; // Default intent
  let blNumber = null;
  let answer = 'For general enquiries, please provide your BL number or contact support for assistance.';

  // Pre-check for canned responses with partial matching
  const lowerMsg = (message || '').toLowerCase().replace(/[^-\w\s]/g, '');
  const cannedKeys = Object.keys(CANNED_RESPONSES);
  let bestMatch = null;
  let highestSimilarity = 0;
  for (const key of cannedKeys) {
    const normalizedKey = key.replace(/[^-\w\s]/g, '');
    if (lowerMsg.includes(normalizedKey)) {
      const similarity = calculateSimilarity(lowerMsg, normalizedKey);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = key;
      }
    }
  }
  if (bestMatch && highestSimilarity > 0.6) {
    intent = 'general_question';
    answer = CANNED_RESPONSES[bestMatch];
    // Custom logic for payment status only
    if (bestMatch === 'how do i check my payment status' && (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0)) {
      const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs;
      const statusLines = [];
      for (let bl of replyBLs) {
        const status = await getPaymentStatus(bl.trim());
        if (status) {
          statusLines.push(`BL ${bl}: Payment status is '${status}'.`);
        } else {
          statusLines.push(`BL ${bl}: No payment status found.`);
        }
      }
      answer = statusLines.join('\n');
      intent = 'ask_payment_status'; // Override intent if payment status is processed
    }
  } else {
    const aiResponse = await getIntentAndResponse(message, conversationHistory[sender].history, validBLs, invalidBLs);
    intent = aiResponse.intent || 'general_question';
    blNumber = aiResponse.bl_number;
    answer = aiResponse.answer || 'Sorry, an unexpected error occurred.';
  }

  // Override intent based on keywords and BL presence, only if explicitly requesting BL data
  if (validBLs.length > 0 || conversationHistory[sender].session.lastValidatedBLs.length > 0) {
    if (/invoice|发票/.test(lowerMsg) && /for bl number/i.test(lowerMsg)) intent = 'request_invoice';
    if (/ctn|container/.test(lowerMsg) && /for bl number/i.test(lowerMsg)) intent = 'ask_ctn_number';
    if (/payment status|check payment/.test(lowerMsg) && /for bl number/i.test(lowerMsg)) intent = 'ask_payment_status';
  } else if (['request_invoice', 'ask_ctn_number', 'ask_payment_status'].includes(intent) && validBLs.length === 0) {
    answer = 'Please provide a BL number to access this information.';
    intent = 'general_question'; // Reset to general to avoid sensitive intent processing
  }

  // Custom handling for overpayment and underpayment
  if (/overpaid.*invoice/i.test(lowerMsg)) {
    const replyBLs = validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0 ? 
      (conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs) : [];
    if (replyBLs.length > 0) {
      answer = `For the following BL(s): ${replyBLs.join(', ')}, we will deduct the overpaid amount from your next invoice. Please provide your BL or CTN number if not already included to process this adjustment.`;
    } else {
      answer = `We will deduct the overpaid amount from your next invoice. Please provide your BL or CTN number to process this adjustment.`;
    }
    intent = 'general_question';
  } else if (/underpaid.*invoice/i.test(lowerMsg)) {
    const replyBLs = validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0 ? 
      (conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs) : [];
    if (replyBLs.length > 0) {
      answer = `For the following BL(s): ${replyBLs.join(', ')}, the underpaid difference will be added to your next invoice. Please provide your BL or CTN number if not already included to process this adjustment.`;
    } else {
      answer = `The underpaid difference will be added to your next invoice. Please provide your BL or CTN number to process this adjustment.`;
    }
    intent = 'general_question';
  }

  if (blNumber) validBLs = Array.from(new Set([...validBLs, ...(Array.isArray(blNumber) ? blNumber : [blNumber])]));

  let reply = answer;
  if (invalidBLs.length > 0 && ['request_invoice', 'ask_ctn_number', 'payment_receipt', 'ask_payment_status'].includes(intent)) {
    reply = `Sorry, the BL number(s) ${invalidBLs.join(', ')} could not be found in our system. Please check and try again.`;
  } else if (validBLs.length < blNumbers.length) {
    reply = `Note: The following BL number(s) ${invalidBLs.join(', ')} were not found. Proceeding with valid BL(s): ${validBLs.join(', ')}.`;
  }

  if (paidAmount !== null && validBLs.length > 0) intent = 'payment_receipt';

  // Enforce verification for sensitive intents before proceeding
  const needsVerification = ['request_invoice', 'ask_ctn_number', 'ask_payment_status'].includes(intent) && 
    (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0);
  if (needsVerification) {
    // Check if verification has expired
    const verificationAge = Date.now() - (conversationHistory[sender].session.verificationTimestamp || 0);
    const validityPeriod = 7200000; // 2 hours in milliseconds
    if (conversationHistory[sender].session.verifiedEmail && verificationAge > validityPeriod) {
      conversationHistory[sender].session.verifiedEmail = null;
      conversationHistory[sender].session.verificationTimestamp = null;
      reply = 'Your verification has expired. Please provide your registered email to access this information.';
    }
    if (!conversationHistory[sender].session.verifiedEmail) {
      const verificationBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs;
      console.log('[DEBUG] BL numbers for verification:', verificationBLs); // Debug BLs being verified
      if (justProvidedEmail) {
        let allVerified = true;
        for (let bl of verificationBLs) {
          const response = await verifySensitiveAccess({ email: justProvidedEmail, bl_number: bl });
          console.log('[DEBUG] Verification Response for BL', bl, ':', response); // Debug each verification
          if (!response.success) {
            allVerified = false;
            reply = `Cannot access info for BL ${bl}: ${response.message || 'Email verification failed.'}`;
            break;
          }
        }
        if (allVerified) {
          conversationHistory[sender].session.verifiedEmail = justProvidedEmail;
          conversationHistory[sender].session.verificationTimestamp = Date.now(); // Set timestamp on successful verification
          // Always re-process the last sensitive user request if it exists
          if (conversationHistory[sender].session.lastSensitiveRequest) {
            const lastSensitive = conversationHistory[sender].session.lastSensitiveRequest;
            conversationHistory[sender].session.lastSensitiveRequest = null;
            conversationHistory[sender].session.pendingResponse = null;
            // Call chatHandler recursively with the last sensitive message and preserved verification BLs
            return await chatHandler(lastSensitive, sender, { ...context, bl_numbers: verificationBLs, skipBLExtraction: true });
          }
          // Only clear pendingBLs after invoice/CTN/payment response is sent
        }
      } else if (!conversationHistory[sender].session.pendingResponse) {
        reply = 'For security, please provide your registered email to access this information.';
        conversationHistory[sender].session.pendingResponse = reply;
      }
    }
  } else if (conversationHistory[sender].session.pendingResponse && justProvidedEmail) {
    conversationHistory[sender].session.pendingResponse = null;
  }

  // Always return both invoice and CTN if both are requested and user is verified, regardless of intent
  const wantsInvoice = /invoice|发票/.test(lowerMsg);
  const wantsCTN = /ctn|container/.test(lowerMsg);
  if ((wantsInvoice && wantsCTN) && (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
    let replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs;
    // Filter out any BLs that contain a comma or whitespace (combined BLs)
    replyBLs = replyBLs.filter(bl => typeof bl === 'string' && !bl.includes(',') && !/\s/.test(bl));
    const replyLines = [];
    for (let bl of replyBLs) {
      // Invoice
      const result = await getInvoiceLink(bl.trim());
      if (result.length > 0 && result[0].invoice_filename) {
        replyLines.push(`For BL ${bl}: Here's your invoice: ${result[0].invoice_filename}`);
      } else {
        replyLines.push(`For BL ${bl}: Invoice not yet issued. Please contact support.`);
      }
      // CTN
      const ctn = await getUniqueNumber(bl.trim());
      if (ctn) {
        replyLines.push(`For BL ${bl}: CTN number is ${ctn}.`);
      } else {
        replyLines.push(`For BL ${bl}: No CTN number found.`);
      }
    }
    reply = replyLines.join('\n');
    conversationHistory[sender].session.pendingBLs = [];
    // Return early so that intent-based blocks below do not override this reply
    logMessage('AI_REPLY', { question: message, reply, user: sender, classification: 'invoice_and_ctn', bl_numbers: replyBLs });
    conversationHistory[sender].history.push({ role: 'assistant', content: reply });
    return reply;
  } else if (intent === 'request_invoice' && (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
    const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs; // Use pendingBLs if available
    console.log('[DEBUG] BLs used for invoice response:', replyBLs); // Debug BLs for response
    const replyLines = [];
    for (let bl of replyBLs) {
      const result = await getInvoiceLink(bl.trim());
      console.log('[DEBUG] getInvoiceLink DB rows for', bl, ':', result); // Debug DB query
      replyLines.push(result.length > 0 && result[0].invoice_filename
        ? `For BL ${bl}: Here's your invoice: ${result[0].invoice_filename}`
        : `For BL ${bl}: Invoice not yet issued. Please contact support.`);
    }
    reply = replyLines.join('\n');
    conversationHistory[sender].session.pendingBLs = []; // Clear after response
  } else if (intent === 'ask_ctn_number' && (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
    const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs; // Use pendingBLs if available
    console.log('[DEBUG] BLs used for CTN response:', replyBLs); // Debug BLs for response
    const replyLines = [];
    for (let bl of replyBLs) {
      const ctn = await getUniqueNumber(bl.trim());
      replyLines.push(ctn ? `For BL ${bl}: CTN number is ${ctn}.` : `For BL ${bl}: No CTN number found.`);
    }
    reply = replyLines.join('\n');
    conversationHistory[sender].session.pendingBLs = []; // Clear after response
  } else if (intent === 'ask_payment_status' && (validBLs.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
    const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : validBLs; // Use pendingBLs if available
    console.log('[DEBUG] BLs used for payment status response:', replyBLs); // Debug BLs for response
    const replyLines = [];
    for (let bl of replyBLs) {
      const status = await getPaymentStatus(bl.trim());
      replyLines.push(status ? `For BL ${bl}: Payment status is '${status}'.` : `For BL ${bl}: No payment status found.`);
    }
    reply = replyLines.join('\n');
    conversationHistory[sender].session.pendingBLs = []; // Clear after response
  } else if (intent === 'payment_receipt' && validBLs.length > 0 && paidAmount !== null) {
    let invoiceSum = 0, invoiceDetails = [];
    const invoiceInfos = await getInvoiceInfo(validBLs);
    for (let bl of validBLs) {
      const info = invoiceInfos.find(row => row.bl_number === bl);
      if (info && (info.ctn_fee !== undefined || info.service_fee !== undefined)) {
        const ctnFee = Number(info.ctn_fee) || 0, serviceFee = Number(info.service_fee) || 0;
        const amount = ctnFee + serviceFee;
        invoiceSum += amount;
        invoiceDetails.push(`BL ${bl}: $${amount} (CTN Fee: $${ctnFee}, Service Fee: $${serviceFee})`);
      } else invoiceDetails.push(`BL ${bl}: No fee data found in DB.`);
    }
    const diff = paidAmount - invoiceSum;
    if (invoiceSum > 0) {
      if (Math.abs(diff) < 0.01 || diff > 0) {
        reply = `We received your payment of $${paidAmount}, which matches the total invoice amount for BL(s):\n${invoiceDetails.join('\n')}`;
        if (diff > 0) reply += `\nYou have overpaid by $${diff.toFixed(2)}. Please contact support for a refund or to allocate the excess.`;
        reply += '\nA receipt will be generated and sent to you shortly.';
        try {
          const pdfPath = await generateReceiptPDF({ blNumbers: validBLs, paidAmount, invoiceDetails, customerName: '' });
          const receiptUrl = await uploadReceiptToCloudinary(pdfPath);
          await updateBLStatusAndReceipt(validBLs, receiptUrl);
          fs.unlink(pdfPath, () => {});
        } catch (e) { console.error('[ERROR] Receipt generation failed:', e); }
      } else if (diff < 0) reply = `We received your payment of $${paidAmount}, but the total invoice amount for BL(s) is $${invoiceSum}.\n${invoiceDetails.join('\n')}\nYou have underpaid by $${Math.abs(diff).toFixed(2)}. Please pay the remaining amount.`;
    } else reply = `We detected a payment of $${paidAmount} for BL number(s): ${validBLs.join(', ')}. If you need a receipt, let us know.`;
  } else if (intent === 'ask_payment_methods') reply = `We accept the following payment methods:\n• Bank Transfer\n• Allinpay\n• Stripe`;
  else if (intent === 'ask_pricing') reply = `Our pricing depends on the number of containers and services required. Please provide your BL number(s) and details for a quote.`;

  if (incomingIsChinese) { reply = await openaiTranslate(reply, 'English', 'Chinese'); if (!/祝商祺|此致敬礼|顺祝商祺|敬请回复/.test(reply)) reply += '\n\n祝商祺！\nIQSTrade客服团队'; }

  logMessage('AI_REPLY', { question: message, reply, user: sender, classification: intent || 'general', bl_numbers: validBLs });
  conversationHistory[sender].history.push({ role: 'assistant', content: reply });
  return reply;
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  const similarities = [];
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let matches = 0;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[i + j] === shorter[j]) matches++;
    }
    similarities.push(matches / shorter.length);
  }
  return similarities.length > 0 ? Math.max(...similarities) : 0;
}

module.exports = chatHandler;
// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const { getInvoiceLink, getUniqueNumber, getValidBLs, getInvoiceInfo, getPaymentStatus } = require('./db'); // Added getPaymentStatus
// const { logMessage } = require('./logger');
// const { generateReceiptPDF, uploadReceiptToCloudinary, updateBLStatusAndReceipt } = require('./receipt_utils');
// const fetch = require('node-fetch');
// const fs = require('fs');


// const conversationHistory = {};

// const SYSTEM_PROMPT = `You are a logistics assistant. Respond in this JSON format:
// {
//   "intent": "request_invoice|ask_ctn_number|ask_payment_methods|ask_pricing|general_question|payment_receipt|other|ask_payment_status",
//   "bl_number": "<BL number if present from context, else null>",
//   "answer": "<Response based on intent and context>"
// }
// - For 'request_invoice', 'ask_ctn_number', 'ask_payment_status', or 'payment_receipt' with invalid BLs [INVALID_BLS], return 'Sorry, the BL number(s) [INVALID_BLS] could not be found in our system. Please check and try again.'
// - For 'general_question', match the query against these phrases and return the corresponding canned response if a partial match is found (e.g., key terms like "ctn" and "processing" for "ctn processing time"):
//   - 'ctn processing time' → 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.'
//   - 'payment methods' → 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.'
//   - 'fees' → 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Contact us for details.'
//   - 'how do i get a copy of my invoice' → 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.'
//   - 'how do i track the status of my ctn' → 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.'
//   - 'what documents do i need to provide for ctn processing' → 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.'
//   - 'how do i upload my bank transfer receipt' → 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.'
//   - 'can i get a refund or cancel my ctn' → 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.'
//   - 'what is the difference between ctn and b l' → 'A Bill of Lading (B/L) is required to initiate CTN processing; a CTN is the note issued to track your cargo documentation status.'
//   - 'what are your business hours' → 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.'
//   - 'how do i contact support' → 'Contact support by replying here or calling [your phone number]. We’re here to help!'
//   - 'can i pay in a different currency' → 'We accept USD only. Contact us in advance to discuss other currency options.'
//   - 'how do i update my company contact information' → 'Update your company or contact info by replying with new details or via our online portal.'
//   - 'how do i check my payment status' → 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.'
//   - 'how do i request urgent processing' → 'For urgent processing, please mention your BL number and the reason for urgency. We will prioritize your request if possible.'
//   - If no sufficient match, return 'For general enquiries, please provide your BL number or contact support for assistance.'
// - For other intents, provide a relevant response based on the context.
// - Context: Valid BLs are [VALID_BLS], invalid BLs are [INVALID_BLS]. Available general enquiry phrases are: ctn processing time, payment methods, fees, how do i get a copy of my invoice, how do i track the status of my ctn, what documents do i need to provide for ctn processing, how do i upload my bank transfer receipt, can i get a refund or cancel my ctn, what is the difference between ctn and b l, what are your business hours, how do i contact support, can i pay in a different currency, how do i update my company contact information, how do i check my payment status, how do i request urgent processing.`;

// // const SYSTEM_PROMPT = `You are a logistics assistant. Respond in this JSON format:
// // {
// //   "intent": "request_invoice|ask_ctn_number|ask_payment_methods|ask_pricing|general_question|payment_receipt|other|ask_payment_status",
// //   "bl_number": "<BL number if present from context, else null>",
// //   "answer": "<Response based on intent and context>"
// // }
// // - For 'request_invoice', 'ask_ctn_number', 'ask_payment_status', or 'payment_receipt' with invalid BLs [INVALID_BLS], return 'Sorry, the BL number(s) [INVALID_BLS] could not be found in our system. Please check and try again.'
// // - For 'general_question', match the query against these phrases and return the corresponding canned response if a partial match is found (e.g., key terms like "ctn" and "processing" for "ctn processing time"):
// //   - 'ctn processing time' → 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.'
// //   - 'payment methods' → 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.'
// //   - 'fees' → 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Pricing is for Bill of Lading (ocean freight) and may differ for Air Waybills.'
// //   - 'how do i get a copy of my invoice' → 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.'
// //   - 'how do i track the status of my ctn' → 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.'
// //   - 'what documents do i need to provide for ctn processing' → 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.'
// //   - 'how do i upload my bank transfer receipt' → 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.'
// //   - 'can i get a refund or cancel my ctn' → 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.'
// //   - 'what is the difference between ctn and b l' → 'A Bill of Lading (B/L) is a carrier-issued shipping document; a Cargo Tracking Note (CTN) is a regulatory document for cargo tracking. Both are essential for your shipment.'
// //   - 'what are your business hours' → 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.'
// //   - 'how do i contact support' → 'Contact support by replying here or calling [your phone number]. We’re here to help!'
// //   - 'can i pay in a different currency' → 'We accept USD only. Contact us in advance to discuss other currency options.'
// //   - 'how do i update my company contact information' → 'Update your company or contact info by replying with new details or via our online portal.'
// //   - 'how do i check my payment status' → 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.'
// //   - 'how do i request urgent processing' → 'For urgent processing, please mention your BL number and reason for urgency. We will prioritize your request if possible.'
// //   - If no sufficient match, return 'For general enquiries, please provide your BL number or contact support for assistance.'
// // - For other intents, provide a relevant response based on the context.
// // - Context: Valid BLs are [VALID_BLS], invalid BLs are [INVALID_BLS]. Available general enquiry phrases are: ctn processing time, payment methods, fees, how do i get a copy of my invoice, how do i track the status of my ctn, what documents do i need to provide for ctn processing, how do i upload my bank transfer receipt, can i get a refund or cancel my ctn, what is the difference between ctn and b l, what are your business hours, how do i contact support, can i pay in a different currency, how do i update my company contact information, how do i check my payment status, how do i request urgent processing.`;

// const CANNED_RESPONSES = {
//   'ctn processing time': 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.',
//   'payment methods': 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.',
//   'fees': 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Contact us for details.',
//   'how do i get a copy of my invoice': 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.',
//   'how do i track the status of my ctn': 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.',
//   'what documents do i need to provide for ctn processing': 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.',
//   'how do i upload my bank transfer receipt': 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.',
//   'can i get a refund or cancel my ctn': 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.',
//   'what is the difference between ctn and b l': 'A Bill of Lading (B/L) is required to initiate CTN processing; a CTN is the note issued to track your cargo documentation status.',
//   'what are your business hours': 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.',
//   'how do i contact support': 'Contact support by replying here or calling [your phone number]. We’re here to help!',
//   'can i pay in a different currency': 'We accept USD only. Contact us in advance to discuss other currency options.',
//   'how do i update my company contact information': 'Update your company or contact info by replying with new details or via our online portal.',
//   'how do i check my payment status': 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.',
//   'how do i request urgent processing': 'For urgent processing, please mention your BL number and the reason for urgency. We will prioritize your request if possible.'
// };

// // const CANNED_RESPONSES = {
// //   'ctn processing time': 'The processing time for a Cargo Tracking Note (CTN) is typically between 24 to 48 hours after your payment has been confirmed. The exact time can vary depending on the payment method used. Let us know if you have further questions.',
// //   'payment methods': 'We accept the following payment methods:\n- Bank Transfer\n- Allinpay\n- Stripe\nChoose the most convenient option. Instructions are provided when you generate a payment link.',
// //   'fees': 'Our current fee structure is:\n- CTN Fee: $100 per container\n- Service Fee: $100 per container\nTotal: $200 per container. Pricing is for Bill of Lading (ocean freight) and may differ for Air Waybills.',
// //   'how do i get a copy of my invoice': 'Request a copy of your invoice by replying here or logging into our portal. Provide your B/L or CTN number if you need assistance.',
// //   'how do i track the status of my ctn': 'To check your CTN status, provide your B/L or CTN number, and we’ll update you soon.',
// //   'what documents do i need to provide for ctn processing': 'For CTN processing, provide:\n- Bill of Lading (B/L)\n- Commercial Invoice\n- Packing List\n- Any other relevant shipping documents\nNo action needed if already submitted.',
// //   'how do i upload my bank transfer receipt': 'Upload your bank transfer receipt by replying with it attached. We’ll process it upon receipt.',
// //   'can i get a refund or cancel my ctn': 'Refunds or cancellations are case-by-case. Provide your B/L or CTN number and reason for review.',
// //   'what is the difference between ctn and b l': 'A Bill of Lading (B/L) is a carrier-issued shipping document; a Cargo Tracking Note (CTN) is a regulatory document for cargo tracking. Both are essential for your shipment.',
// //   'what are your business hours': 'We’re open Monday to Friday, 9:00 AM to 6:00 PM (local time). Responses within one business day.',
// //   'how do i contact support': 'Contact support by replying here or calling [your phone number]. We’re here to help!',
// //   'can i pay in a different currency': 'We accept USD only. Contact us in advance to discuss other currency options.',
// //   'how do i update my company contact information': 'Update your company or contact info by replying with new details or via our online portal.',
// //   'how do i check my payment status': 'To check your payment status, provide your BL number. We will update you on the current status of your payment after verification.',
// //   'how do i request urgent processing': 'For urgent processing, please mention your BL number and the reason for urgency. We will prioritize your request if possible.'
// // };


// function isEmail(str) { return typeof str === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str.trim()); }
// function isChinese(text) { if (!text) return false; const chineseChars = Array.from(text).filter(c => /[\u4e00-\u9fff]/.test(c)).length; return chineseChars > 0 && chineseChars / Math.max(1, text.length) > 0.2; }
// // // function extractBLNumbers(text) { const blPattern = /(?:提单号[:：]?\s*)?([A-Z]{2,4}\d{2,}|BL-\d{4,}|\d{3,}-\d{3,}|\d{6,}|\d{4,})/gi; const extraBLs = text.split(/[,\s]+/).filter(x => /^[A-Z]{2,4}\d{2,}$|^\d{4,}$/.test(x)); let matches = []; let match; while ((match = blPattern.exec(text)) !== null) if (match[1]) matches.push(match[1]); return Array.from(new Set([...matches, ...extraBLs])); }
// function extractPaymentAmount(text) { if (!text) return null; const patterns = [/\$\s?([0-9]+(?:\.[0-9]{1,2})?)/i, /USD\s*([0-9]+(?:\.[0-9]{1,2})?)/i, /Amount[:：]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i, /Paid[:：]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i]; for (const pat of patterns) { const match = text.match(pat); if (match) try { return parseFloat(match[1]); } catch (e) { continue; } } return null; }
// function extractBLNumbers(text) {
//   const blPattern = /(?:提单号[:：]?\s*)?([A-Z]{2,4}\d{2,}|BL-\d{4,}|\d{3,}-\d{3,}|\d{6,}|\d{4,})/gi;
//   const extraBLs = text.split(/[,\s]+/).filter(x => /^[A-Z]{2,4}\d{2,}$|^\d{4,}$|^\d{3}-\d{3}$/.test(x) && !x.includes('@')); // Exclude emails
//   let matches = [];
//   let match;
//   while ((match = blPattern.exec(text)) !== null) if (match[1] && !match[1].includes('@')) matches.push(match[1]);
//   return Array.from(new Set([...matches, ...extraBLs]));
// }


// async function openaiTranslate(text, sourceLang, targetLang) { try { const translationPrompt = `Translate the following ${sourceLang} text to ${targetLang}. Only return the translated text, no explanation.\n\n${text}`; const response = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'system', content: 'You are a professional translator.' }, { role: 'user', content: translationPrompt }], temperature: 0 }); return response.choices[0].message.content.trim(); } catch (e) { console.error('[OpenAI Translate] Failed:', e); return text; } }

// async function getIntentAndResponse(message, history, validBLs, invalidBLs) {
//   const context = `Valid BLs are ${validBLs.join(', ') || 'none'}, invalid BLs are ${invalidBLs.join(', ') || 'none'}.`;
//   const messages = [{ role: 'system', content: SYSTEM_PROMPT.replace('[VALID_BLS]', validBLs.join(', ') || 'none').replace('[INVALID_BLS]', invalidBLs.join(', ') || 'none') }, ...history];
//   try {
//     const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'system', content: context }, ...messages], max_tokens: 300 });
//     const content = completion.choices[0].message.content.trim();
//     let result = {};
//     try { result = JSON.parse(content.replace(/```json\n|\n```/g, '')); } catch (e) { result = { intent: 'general_question', bl_number: null, answer: content }; }
//     console.log('[OpenAI JSON Response]:', JSON.stringify(result, null, 2));
//     return result;
//   } catch (e) { console.error('[OpenAI Error]:', e); return { intent: 'general_question', bl_number: null, answer: 'Sorry, an unexpected error occurred.' }; }
// }



// async function verifySensitiveAccess({ email, bl_number }) {
//   try {
//     const res = await fetch(`${process.env.FRONTEND_URL || 'https://iqstrade.onrender.com'}/api/verify_sensitive_access`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ email, bl_number })
//     });
//     const data = await res.json(); // Parse JSON directly
//     console.log('[DEBUG] Verification Response:', data); // Log the parsed response
//     if (!res.ok) {
//       throw new Error(data.message || 'Verification request failed');
//     }
//     return data;
//   } catch (e) {
//     console.error('[Verification Error]:', e.message);
//     return { success: false, message: e.message || 'Error during verification' };
//   }
// }

// async function chatHandler(message, sender, context = {}) {
//   if (context.messages && context.messages[0]?.key?.fromMe) return '';

//   if (!conversationHistory[sender]) conversationHistory[sender] = { history: [], session: { verifiedEmail: null, lastSentMsg: null, pendingResponse: null, pendingBLs: [] } };
//   conversationHistory[sender].history.push({ role: 'user', content: message || '' }); // Ensure message is defined

//   const incomingIsChinese = isChinese(message);
//   let blNumbers = extractBLNumbers(message || ''); // Extract BL numbers from current message
//   console.log('[DEBUG] Extracted BL numbers from message:', blNumbers); // Debug extracted BLs
//   let paidAmount = extractPaymentAmount(message) || (context.paid_amount || null);
//   let userEmail = conversationHistory[sender].session.verifiedEmail || context.email;
//   let justProvidedEmail = isEmail(message) ? message.trim() : null;

//   // Prioritize BLs from PDF if present
//   if (context.bl_numbers) {
//     blNumbers = Array.from(new Set([...context.bl_numbers, ...blNumbers])); // PDF BLs first
//     conversationHistory[sender].history = conversationHistory[sender].history.filter(h => !h.content.startsWith('Untitled')); // Clear previous PDF context
//   }

//   // Store BLs from the initial request if verification is pending
//   if (blNumbers.length > 0 && !conversationHistory[sender].session.verifiedEmail && !justProvidedEmail) {
//     conversationHistory[sender].session.pendingBLs = blNumbers;
//     // Store the last sensitive user request for replay after verification
//     conversationHistory[sender].session.lastSensitiveRequest = message;
//     console.log('[DEBUG] Stored pending BLs:', blNumbers);
//   }

//   // DB check first
//   const validBLs = blNumbers.length > 0 ? await getValidBLs(blNumbers) : [];
//   console.log('[DEBUG] Valid BLs from DB:', validBLs); // Debug valid BLs
//   const invalidBLs = blNumbers.filter(bl => !validBLs.includes(bl));
//   blNumbers = validBLs;

//   let intent = 'general_question'; // Default intent
//   let blNumber = null;
//   let answer = 'For general enquiries, please provide your BL number or contact support for assistance.';

//   // Pre-check for canned responses with partial matching
//   const lowerMsg = (message || '').toLowerCase().replace(/[^-\w\s]/g, '');
//   const cannedKeys = Object.keys(CANNED_RESPONSES);
//   let bestMatch = null;
//   let highestSimilarity = 0;
//   for (const key of cannedKeys) {
//     const normalizedKey = key.replace(/[^-\w\s]/g, '');
//     if (lowerMsg.includes(normalizedKey)) {
//       const similarity = calculateSimilarity(lowerMsg, normalizedKey);
//       if (similarity > highestSimilarity) {
//         highestSimilarity = similarity;
//         bestMatch = key;
//       }
//     }
//   }
//   if (bestMatch && highestSimilarity > 0.6) {
//     intent = 'general_question';
//     answer = CANNED_RESPONSES[bestMatch];
//     // Custom logic for payment status
//     if (bestMatch === 'how do i check my payment status' && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0)) {
//       const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers;
//       const statusLines = [];
//       for (let bl of replyBLs) {
//         const status = await getPaymentStatus(bl.trim());
//         if (status) {
//           statusLines.push(`BL ${bl}: Payment status is '${status}'.`);
//         } else {
//           statusLines.push(`BL ${bl}: No payment status found.`);
//         }
//       }
//       answer = statusLines.join('\n');
//       intent = 'ask_payment_status'; // Override intent if payment status is processed
//     }
//   } else {
//     const aiResponse = await getIntentAndResponse(message, conversationHistory[sender].history, validBLs, invalidBLs);
//     intent = aiResponse.intent || 'general_question';
//     blNumber = aiResponse.bl_number;
//     answer = aiResponse.answer || 'Sorry, an unexpected error occurred.';
//   }

//   // Override intent based on keywords and BL presence
//   if (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) {
//     if (/invoice|发票/.test(lowerMsg)) intent = 'request_invoice';
//     if (/ctn|container/.test(lowerMsg)) intent = 'ask_ctn_number';
//     if (/payment status|check payment/.test(lowerMsg)) intent = 'ask_payment_status';
//   }

//   if (blNumber) blNumbers = Array.from(new Set([...blNumbers, ...(Array.isArray(blNumber) ? blNumber : [blNumber])]));

//   let reply = answer;
//   if (invalidBLs.length > 0 && ['request_invoice', 'ask_ctn_number', 'payment_receipt', 'ask_payment_status'].includes(intent)) {
//     reply = `Sorry, the BL number(s) ${invalidBLs.join(', ')} could not be found in our system. Please check and try again.`;
//   } else if (validBLs.length < blNumbers.length) {
//     reply = `Note: The following BL number(s) ${invalidBLs.join(', ')} were not found. Proceeding with valid BL(s): ${validBLs.join(', ')}.`;
//   }

//   if (paidAmount !== null && blNumbers.length > 0) intent = 'payment_receipt';

//   // Enforce verification for sensitive intents before proceeding
//   const needsVerification = ['request_invoice', 'ask_ctn_number', 'ask_payment_status'].includes(intent) && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0);
//   if (needsVerification && !conversationHistory[sender].session.verifiedEmail) {
//     const verificationBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers;
//     console.log('[DEBUG] BL numbers for verification:', verificationBLs); // Debug BLs being verified
//     if (justProvidedEmail) {
//       let allVerified = true;
//       for (let bl of verificationBLs) {
//         const response = await verifySensitiveAccess({ email: justProvidedEmail, bl_number: bl });
//         console.log('[DEBUG] Verification response for BL', bl, ':', response); // Debug each verification
//         if (!response.success) {
//           allVerified = false;
//           reply = `Cannot access info for BL ${bl}: ${response.message || 'Email verification failed.'}`;
//           break;
//         }
//       }
//       if (allVerified) {
//         conversationHistory[sender].session.verifiedEmail = justProvidedEmail;
//         // Always re-process the last sensitive user request if it exists
//         if (conversationHistory[sender].session.lastSensitiveRequest) {
//           const lastSensitive = conversationHistory[sender].session.lastSensitiveRequest;
//           conversationHistory[sender].session.lastSensitiveRequest = null;
//           conversationHistory[sender].session.pendingResponse = null;
//           // Call chatHandler recursively with the last sensitive message, but with updated session (verified)
//           return await chatHandler(lastSensitive, sender, context);
//         }
//         // Only clear pendingBLs after invoice/CTN/payment response is sent
//       }
//     } else if (!conversationHistory[sender].session.pendingResponse) {
//       reply = 'For security, please provide your registered email to access this information.';
//       conversationHistory[sender].session.pendingResponse = reply;
//     }
//   } else if (conversationHistory[sender].session.pendingResponse && justProvidedEmail) {
//     conversationHistory[sender].session.pendingResponse = null;
//   }

//   // Always return both invoice and CTN if both are requested and user is verified, regardless of intent
//   const wantsInvoice = /invoice|发票/.test(lowerMsg);
//   const wantsCTN = /ctn|container/.test(lowerMsg);
//   if ((wantsInvoice && wantsCTN) && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
//     let replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers;
//     // Filter out any BLs that contain a comma or whitespace (combined BLs)
//     replyBLs = replyBLs.filter(bl => typeof bl === 'string' && !bl.includes(',') && !/\s/.test(bl));
//     const replyLines = [];
//     for (let bl of replyBLs) {
//       // Invoice
//       const result = await getInvoiceLink(bl.trim());
//       if (result.length > 0 && result[0].invoice_filename) {
//         replyLines.push(`For BL ${bl}: Here's your invoice: ${result[0].invoice_filename}`);
//       } else {
//         replyLines.push(`For BL ${bl}: Invoice not yet issued. Please contact support.`);
//       }
//       // CTN
//       const ctn = await getUniqueNumber(bl.trim());
//       if (ctn) {
//         replyLines.push(`For BL ${bl}: CTN number is ${ctn}.`);
//       } else {
//         replyLines.push(`For BL ${bl}: No CTN number found.`);
//       }
//     }
//     reply = replyLines.join('\n');
//     conversationHistory[sender].session.pendingBLs = [];
//     // Return early so that intent-based blocks below do not override this reply
//     logMessage('AI_REPLY', { question: message, reply, user: sender, classification: 'invoice_and_ctn', bl_numbers: replyBLs });
//     conversationHistory[sender].history.push({ role: 'assistant', content: reply });
//     return reply;
//   } else if (intent === 'request_invoice' && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
//     const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers; // Use pendingBLs if available
//     console.log('[DEBUG] BLs used for invoice response:', replyBLs); // Debug BLs for response
//     const replyLines = [];
//     for (let bl of replyBLs) {
//       const result = await getInvoiceLink(bl.trim());
//       console.log('[DEBUG] getInvoiceLink DB rows for', bl, ':', result); // Debug DB query
//       replyLines.push(result.length > 0 && result[0].invoice_filename
//         ? `For BL ${bl}: Here's your invoice: ${result[0].invoice_filename}`
//         : `For BL ${bl}: Invoice not yet issued. Please contact support.`);
//     }
//     reply = replyLines.join('\n');
//     conversationHistory[sender].session.pendingBLs = []; // Clear after response
//   } else if (intent === 'ask_ctn_number' && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
//     const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers; // Use pendingBLs if available
//     console.log('[DEBUG] BLs used for CTN response:', replyBLs); // Debug BLs for response
//     const replyLines = [];
//     for (let bl of replyBLs) {
//       const ctn = await getUniqueNumber(bl.trim());
//       replyLines.push(ctn ? `For BL ${bl}: CTN number is ${ctn}.` : `For BL ${bl}: No CTN number found.`);
//     }
//     reply = replyLines.join('\n');
//     conversationHistory[sender].session.pendingBLs = []; // Clear after response
//   } else if (intent === 'ask_payment_status' && (blNumbers.length > 0 || conversationHistory[sender].session.pendingBLs.length > 0) && conversationHistory[sender].session.verifiedEmail) {
//     const replyBLs = conversationHistory[sender].session.pendingBLs.length > 0 ? conversationHistory[sender].session.pendingBLs : blNumbers; // Use pendingBLs if available
//     console.log('[DEBUG] BLs used for payment status response:', replyBLs); // Debug BLs for response
//     const replyLines = [];
//     for (let bl of replyBLs) {
//       const status = await getPaymentStatus(bl.trim());
//       replyLines.push(status ? `For BL ${bl}: Payment status is '${status}'.` : `For BL ${bl}: No payment status found.`);
//     }
//     reply = replyLines.join('\n');
//     conversationHistory[sender].session.pendingBLs = []; // Clear after response
//   } else if (intent === 'payment_receipt' && blNumbers.length > 0 && paidAmount !== null) {
//     let invoiceSum = 0, invoiceDetails = [];
//     const invoiceInfos = await getInvoiceInfo(blNumbers);
//     for (let bl of blNumbers) {
//       const info = invoiceInfos.find(row => row.bl_number === bl);
//       if (info && (info.ctn_fee !== undefined || info.service_fee !== undefined)) {
//         const ctnFee = Number(info.ctn_fee) || 0, serviceFee = Number(info.service_fee) || 0;
//         const amount = ctnFee + serviceFee;
//         invoiceSum += amount;
//         invoiceDetails.push(`BL ${bl}: $${amount} (CTN Fee: $${ctnFee}, Service Fee: $${serviceFee})`);
//       } else invoiceDetails.push(`BL ${bl}: No fee data found in DB.`);
//     }
//     const diff = paidAmount - invoiceSum;
//     if (invoiceSum > 0) {
//       if (Math.abs(diff) < 0.01 || diff > 0) {
//         reply = `We received your payment of $${paidAmount}, which matches the total invoice amount for BL(s):\n${invoiceDetails.join('\n')}`;
//         if (diff > 0) reply += `\nYou have overpaid by $${diff.toFixed(2)}. Please contact support for a refund or to allocate the excess.`;
//         reply += '\nA receipt will be generated and sent to you shortly.';
//         try {
//           const pdfPath = await generateReceiptPDF({ blNumbers, paidAmount, invoiceDetails, customerName: '' });
//           const receiptUrl = await uploadReceiptToCloudinary(pdfPath);
//           await updateBLStatusAndReceipt(blNumbers, receiptUrl);
//           fs.unlink(pdfPath, () => {});
//         } catch (e) { console.error('[ERROR] Receipt generation failed:', e); }
//       } else if (diff < 0) reply = `We received your payment of $${paidAmount}, but the total invoice amount for BL(s) is $${invoiceSum}.\n${invoiceDetails.join('\n')}\nYou have underpaid by $${Math.abs(diff).toFixed(2)}. Please pay the remaining amount.`;
//     } else reply = `We detected a payment of $${paidAmount} for BL number(s): ${blNumbers.join(', ')}. If you need a receipt, let us know.`;
//   } else if (intent === 'ask_payment_methods') reply = `We accept the following payment methods:\n• Bank Transfer\n• Allinpay\n• Stripe`;
//   else if (intent === 'ask_pricing') reply = `Our pricing depends on the number of containers and services required. Please provide your BL number(s) and details for a quote.`;

//   if (incomingIsChinese) { reply = await openaiTranslate(reply, 'English', 'Chinese'); if (!/祝商祺|此致敬礼|顺祝商祺|敬请回复/.test(reply)) reply += '\n\n祝商祺！\nIQSTrade客服团队'; }

//   logMessage('AI_REPLY', { question: message, reply, user: sender, classification: intent || 'general', bl_numbers: blNumbers });
//   conversationHistory[sender].history.push({ role: 'assistant', content: reply });
//   return reply;
// }


// function calculateSimilarity(str1, str2) {
//   const longer = str1.length > str2.length ? str1 : str2;
//   const shorter = str1.length > str2.length ? str2 : str1;
//   const similarities = [];
//   for (let i = 0; i <= longer.length - shorter.length; i++) {
//     let matches = 0;
//     for (let j = 0; j < shorter.length; j++) {
//       if (longer[i + j] === shorter[j]) matches++;
//     }
//     similarities.push(matches / shorter.length);
//   }
//   return similarities.length > 0 ? Math.max(...similarities) : 0;
// }

// module.exports = chatHandler;


