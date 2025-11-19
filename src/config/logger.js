const winston = require("winston");
require("winston-daily-rotate-file");
const path = require("path");

// Formato personalizado para consola y archivos
const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

// Transporte para archivos rotativos
const transport = new winston.transports.DailyRotateFile({
  dirname: path.join(__dirname, "..", "logs"),   // Carpeta de logs
  filename: "app-%DATE%.log",                    // Nombre con fecha
  datePattern: "YYYY-MM-DD",                     // Formato de fecha
  zippedArchive: false,                          // No comprimir logs
  maxSize: "10m",                                 // Tamaño máximo por archivo
  maxFiles: "14d",                                // Conservar 14 días
});

// Logger principal
const logger = winston.createLogger({
  level: "info",
  format: combine(timestamp({ format: "DD/MM/YYYY HH:mm:ss" }), logFormat),
  transports: [
    transport,
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), logFormat),
    }),
  ],
});

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = (...args) => {
  const message = args.map(String).join(" ");
  logger.info(message);
  originalConsoleLog(...args);
};

console.warn = (...args) => {
  const message = args.map(String).join(" ");
  logger.warn(message);
  originalConsoleWarn(...args);
};

console.error = (...args) => {
  const message = args.map(String).join(" ");
  logger.error(message);
  originalConsoleError(...args);
};

module.exports = logger;
