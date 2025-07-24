const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const logDirectory = path.resolve(__dirname, 'logs');

const transport = new winston.transports.DailyRotateFile({
  filename: `${logDirectory}/activity-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '5m',
  maxFiles: '14d'
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(info => `[${info.timestamp}] [${info.level.toUpperCase()}] ${info.message}`)
  ),
  transports: [transport]
});

function logMessage(type, data) {
  const message = `[${type}] ${JSON.stringify(data)}`;
  logger.info(message);
}

module.exports = { logger, logMessage }; 