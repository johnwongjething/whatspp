const express = require('express');
require('dotenv').config();  // loads environment variables from .env

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://iqstrade.onrender.com';
const app = express();
const port = process.env.PORT || 3000;

app.get('/healthz', (_, res) => {
  res.send('OK');
});

app.listen(port, () => {
  console.log(`Healthcheck server running on port ${port}`);
}); 