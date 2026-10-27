/**
 * Cross-platform local development server.
 *
 * Starts the MongoDB binary managed by mongodb-memory-server, keeps its data
 * under backend/.data, and then starts the API. No system MongoDB install is
 * required.
 *
 * Usage: npm run dev:local
 */
import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.LOCAL_MONGO_DB_PATH
  ? path.resolve(process.env.LOCAL_MONGO_DB_PATH)
  : path.join(__dirname, '.data', 'mongodb');

async function main() {
  const { default: logger } = await import('./utils/logger.js');

  fs.mkdirSync(DB_PATH, { recursive: true });

  logger.info('Starting local MongoDB...');
  const mongod = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGOMS_VERSION || '8.2.6',
      checkMD5: false,
    },
    instance: {
      dbName: 'salesdam',
      dbPath: DB_PATH,
      ip: '127.0.0.1',
      port: Number(process.env.MONGO_PORT || 27017),
      storageEngine: 'ephemeralForTest',
    },
  });

  process.env.MONGO_URI = mongod.getUri('salesdam');

  const { default: app } = await import('./app.js');
  const { default: connectDB } = await import('./config/db.js');

  await connectDB();

  const port = Number(process.env.PORT || 5000);
  const server = http.createServer(app);

  const shutdown = async (signal) => {
    logger.info(`${signal} received; shutting down local services...`);
    server.close(async () => {
      await mongod.stop();
      process.exit(0);
    });
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  server.listen(port, () => {
    logger.info(`Backend running on http://localhost:${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
  });
}

main().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
