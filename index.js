require('dotenv').config();
console.log('TEST_ENV:', process.env.TEST_ENV || 'Missing');
console.log('ENV DEBUG:');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Loaded' : 'Missing');
console.log('RAILWAY_DB_HOST:', process.env.RAILWAY_DB_HOST || 'Missing');
console.log('RAILWAY_DB_USER:', process.env.RAILWAY_DB_USER || 'Missing');
console.log('RAILWAY_DB_PASSWORD:', process.env.RAILWAY_DB_PASSWORD ? 'Loaded' : 'Missing');
console.log('RAILWAY_DB_NAME:', process.env.RAILWAY_DB_NAME || 'Missing');
console.log('RAILWAY_DB_PORT:', process.env.RAILWAY_DB_PORT || 'Missing');
console.log('ADMIN_WA_ID:', process.env.ADMIN_WA_ID || 'Missing');

const whatsappClient = require('./whatsappClient');
const { startMessageHandling } = require('./messageRouter');
require('./server'); // Start healthcheck service

async function startBot() {
  try {
    const client = await whatsappClient();
    await startMessageHandling(client);
    console.log('Bot started and message handling initialized.');
  } catch (error) {
    console.error('Failed to start bot:', error);
  }
}

startBot();

// require('dotenv').config();
// console.log('TEST_ENV:', process.env.TEST_ENV || 'Missing');
// console.log('ENV DEBUG:');
// console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Loaded' : 'Missing');
// console.log('RAILWAY_DB_HOST:', process.env.RAILWAY_DB_HOST || 'Missing');
// console.log('RAILWAY_DB_USER:', process.env.RAILWAY_DB_USER || 'Missing');
// console.log('RAILWAY_DB_PASSWORD:', process.env.RAILWAY_DB_PASSWORD ? 'Loaded' : 'Missing');
// console.log('RAILWAY_DB_NAME:', process.env.RAILWAY_DB_NAME || 'Missing');
// console.log('RAILWAY_DB_PORT:', process.env.RAILWAY_DB_PORT || 'Missing');
// console.log('ADMIN_WA_ID:', process.env.ADMIN_WA_ID || 'Missing');
// console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Loaded' : 'Missing');
// const whatsappClient = require('./whatsappClient');
// const messageRouter = require('./messageRouter');
// require('./server'); // start healthcheck service

// // Start WhatsApp client and set up message handling
// (async () => {
//   const client = await whatsappClient();
//   client.ev.on('messages.upsert', async (msg) => {
//     await messageRouter(client, msg);
//   });
// })(); 