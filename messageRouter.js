const chatHandler = require('./chatHandler');
const { logMessage } = require('./logger');
const { extractFieldsFromPDF } = require('./pdf_extractor_openai');
const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// Debounce lock to prevent double processing
const processingLock = new Map();
const LOCK_TIMEOUT_MS = 2000; // 2 seconds debounce

function releaseLock(key) {
  setTimeout(() => processingLock.delete(key), LOCK_TIMEOUT_MS);
}

async function startMessageHandling(client) {
  client.ev.on('messages.upsert', async (msgEvent) => {
    const { messages, type } = msgEvent;
    if (!messages || !Array.isArray(messages) || messages.length === 0 || type === 'append') {
      console.log('[Debug] Skipping invalid or append event:', { type, messageCount: messages?.length });
      return;
    }

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) {
        console.log('[Debug] Skipping self or invalid message:', { sender: msg.key.remoteJid, fromMe: msg.key.fromMe, messageId: msg.key.id });
        continue;
      }

      const sender = msg.key.remoteJid;
      const messageId = msg.key.id;
      const key = `${sender}:${messageId}`;

      if (processingLock.has(key)) {
        console.log('[Debug] Skipping duplicate message due to lock:', { sender, messageId });
        continue;
      }

      processingLock.set(key, true);
      try {
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        let pdfFields = null;
        let localFilePath = null;

        // Handle attachments
        const docMsg = msg.message.documentMessage;
        const imgMsg = msg.message.imageMessage;
        if (docMsg && (docMsg.mimetype === 'application/pdf' || docMsg.mimetype.startsWith('image/'))) {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          const ext = docMsg.mimetype === 'application/pdf' ? '.pdf' : (docMsg.fileName ? path.extname(docMsg.fileName) : '.jpg');
          const fileName = docMsg.fileName || `wa_${Date.now()}${ext}`;
          const savePath = path.join(__dirname, 'downloads');
          if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
          localFilePath = path.join(savePath, fileName);
          fs.writeFileSync(localFilePath, buffer);
          logMessage('INCOMING_FILE', { from: sender, file: localFilePath, mimetype: docMsg.mimetype });
          pdfFields = await extractFieldsFromPDF(localFilePath);
        } else if (imgMsg) {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          const fileName = `wa_img_${Date.now()}.jpg`;
          const savePath = path.join(__dirname, 'downloads');
          if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
          localFilePath = path.join(savePath, fileName);
          fs.writeFileSync(localFilePath, buffer);
          logMessage('INCOMING_IMAGE', { from: sender, file: localFilePath });
          pdfFields = await extractFieldsFromPDF(localFilePath);
        }

        logMessage('INCOMING_MESSAGE', { from: sender, message: text });
        let reply = localFilePath && (!text || text.trim() === '')
          ? pdfFields && Object.keys(pdfFields).length > 0
            ? await chatHandler('', sender, pdfFields)
            : 'We received your receipt. Please provide your BL number or payment details so we can process your payment.'
          : await chatHandler(text, sender, pdfFields || {});

        if (reply) {
          console.log('DEBUG: Sending reply to', sender, 'with text:', reply);
          await client.sendMessage(sender, { text: reply });
          console.log('DEBUG: Reply sent to', sender);
        }

        const adminId = process.env.ADMIN_WA_ID;
        if (adminId && sender !== adminId) {
          const adminMsg = `Customer ${sender} asked: "${text}"
AI replied: "${reply || 'No reply generated'}"`;
          await client.sendMessage(adminId, { text: adminMsg });
        }
      } catch (error) {
        console.error('Error processing message:', error);
      } finally {
        releaseLock(key);
      }
    }
  });
}

module.exports = { startMessageHandling };
// const chatHandler = require('./chatHandler');
// const { logMessage } = require('./logger');
// const { extractFieldsFromPDF } = require('./pdf_extractor_openai');
// const fs = require('fs');
// const path = require('path');
// const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// async function messageRouter(client, msgEvent) {
//   console.log('DEBUG: messageRouter called with msgEvent:', JSON.stringify(msgEvent));
//   const adminId = process.env.ADMIN_WA_ID;
//   const messages = msgEvent.messages || [];
//   for (const msg of messages) {
//     if (!msg.message || msg.key.fromMe) continue; // Ignore system and own messages
//     const sender = msg.key.remoteJid;
//     const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
//     let pdfFields = null;
//     // Detect PDF or image attachment (Baileys v6+)
//     const docMsg = msg.message.documentMessage;
//     const imgMsg = msg.message.imageMessage;
//     let localFilePath = null;
//     if (docMsg && (docMsg.mimetype === 'application/pdf' || docMsg.mimetype.startsWith('image/'))) {
//       // Save PDF or image to disk
//       const buffer = await downloadMediaMessage(msg, 'buffer', {});
//       const ext = docMsg.mimetype === 'application/pdf' ? '.pdf' : (docMsg.fileName ? path.extname(docMsg.fileName) : '.jpg');
//       const fileName = docMsg.fileName || `wa_${Date.now()}${ext}`;
//       const savePath = path.join(__dirname, 'downloads');
//       if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
//       localFilePath = path.join(savePath, fileName);
//       fs.writeFileSync(localFilePath, buffer);
//       logMessage('INCOMING_FILE', { from: sender, file: localFilePath, mimetype: docMsg.mimetype });
//       // Extract fields from file
//       pdfFields = await extractFieldsFromPDF(localFilePath);
//     } else if (imgMsg) {
//       // Handle direct image messages (e.g., photos taken from phone)
//       const buffer = await downloadMediaMessage(msg, 'buffer', {});
//       const fileName = `wa_img_${Date.now()}.jpg`;
//       const savePath = path.join(__dirname, 'downloads');
//       if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
//       localFilePath = path.join(savePath, fileName);
//       fs.writeFileSync(localFilePath, buffer);
//       logMessage('INCOMING_IMAGE', { from: sender, file: localFilePath });
//       pdfFields = await extractFieldsFromPDF(localFilePath);
//     }

//     // Log incoming message
//     logMessage('INCOMING_MESSAGE', { from: sender, message: text });

//     // Special handling: PDF uploaded with no text
//     let reply;
//     if (localFilePath && (!text || text.trim() === '')) {
//       if (pdfFields && Object.keys(pdfFields).length > 0) {
//         // If fields were extracted from PDF, treat as business logic input
//         try {
//           reply = await chatHandler('', sender, pdfFields, client);
//         } catch (err) {
//           reply = 'Sorry, there was an error processing your request.';
//           console.error('AI error:', err);
//         }
//       } else {
//         reply = 'We received your receipt. Please provide your BL number or payment details so we can process your payment.';
//       }
//     } else {
//       try {
//         // Pass client to chatHandler for optional admin alert
//         // Pass pdfFields as context for merging BL/payment
//         reply = await chatHandler(text, sender, pdfFields || {}, client);
//       } catch (err) {
//         reply = 'Sorry, there was an error processing your request.';
//         console.error('AI error:', err);
//       }
//     }

//     // Reply to customer
//     console.log('DEBUG: Sending reply to', sender, 'with text:', reply);
//     await client.sendMessage(sender, { text: reply });
//     console.log('DEBUG: Reply sent to', sender);

//     // Forward to admin
//     if (adminId && sender !== adminId) {
//       const adminMsg = `Customer ${sender} asked: "${text}"
// AI replied: "${reply}"`;
//       await client.sendMessage(adminId, { text: adminMsg });
//     }
//   }
// }

// module.exports = messageRouter; 