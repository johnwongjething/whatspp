const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const Pino = require('pino');

let clientInstance = null;

async function whatsappClient() {
  if (clientInstance) return clientInstance;

  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const logger = Pino({ level: 'debug' });

  const client = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
  });

  client.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        whatsappClient(); // Recreate on non-logout disconnect
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection established.');
    }
  });

  client.ev.on('creds.update', saveCreds);

  clientInstance = client;
  return clientInstance;
}

module.exports = whatsappClient;