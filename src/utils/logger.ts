import winston from "winston";
import { IndexerError } from "../types";

const { combine, timestamp, printf, colorize } = winston.format;

// Custom format for log messages
const logFormat = printf(({ level, message, timestamp, error }) => {
  let logMessage = `${timestamp} [${level}]: ${message}`;
  
  // Add error details if present
  if (error instanceof IndexerError) {
    logMessage += `\nError Type: ${error.type}`;
    if (error.originalError) {
      logMessage += `\nOriginal Error: ${error.originalError.message}`;
    }
  } else if (error instanceof Error) {
    logMessage += `\nError: ${error.message}`;
    if (error.stack) {
      logMessage += `\nStack: ${error.stack}`;
    }
  }
  
  return logMessage;
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    // Console transport with colors for development
    new winston.transports.Console({
      format: combine(
        colorize(),
        logFormat
      )
    }),
    // File transport for persistent logs
    new winston.transports.File({
      filename: "indexer-error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "indexer.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// Helper methods for structured logging
export const log = {
  info: (message: string, metadata?: any) => {
    logger.info(message, metadata);
  },
  
  error: (message: string, error?: Error | IndexerError) => {
    logger.error(message, { error });
  },
  
  warn: (message: string, metadata?: any) => {
    logger.warn(message, metadata);
  },
  
  debug: (message: string, metadata?: any) => {
    logger.debug(message, metadata);
  },

  // Specific indexer events
  syncProgress: (current: number, target: number) => {
    const progress = ((current / target) * 100).toFixed(2);
    logger.info(`Sync Progress: ${progress}% (Block ${current}/${target})`);
  },

  transferEvent: (tokenId: string, from: string, to: string, blockNumber: number) => {
    logger.debug(
      `Transfer Event - TokenID: ${tokenId}, From: ${from}, To: ${to}, Block: ${blockNumber}`
    );
  },

  metadataUpdate: (tokenId: string, success: boolean, error?: Error) => {
    if (success) {
      logger.debug(`Updated metadata for token ${tokenId}`);
    } else {
      logger.error(`Failed to update metadata for token ${tokenId}`, { error });
    }
  },

  rpcCall: (method: string, duration: number) => {
    logger.debug(`RPC Call - Method: ${method}, Duration: ${duration}ms`);
  }
};

// Export the winston logger instance for advanced usage
export const rawLogger = logger;
