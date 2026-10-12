import { mkdirSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from './config.js';

let servidorLocal = null;

export async function conectar() {
  let uri = config.mongoUri;

  if (!uri) {
    // Sin MONGODB_URI: se levanta un mongod propio con los datos guardados en ./data/mongo
    // La variante "core" no descarga nada al instalar, solo la primera vez que se usa.
    const { MongoMemoryServer } = await import('mongodb-memory-server-core');
    const dbPath = path.resolve('data/mongo');
    mkdirSync(dbPath, { recursive: true });
    console.log('MONGODB_URI no está definida: iniciando MongoDB local en', dbPath);
    console.log('(la primera vez descarga el binario de MongoDB y puede tardar unos minutos)');
    servidorLocal = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger', dbName: 'gastos' },
    });
    uri = servidorLocal.getUri('gastos');
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    console.error('\nNo se pudo conectar a MongoDB:', err.message);
    console.error('Revisa en .env el usuario, la contraseña y el servidor, y que en Atlas');
    console.error('(Network Access) esté permitida la IP desde la que te conectas.\n');
    process.exit(1);
  }
  console.log(`Conectado a MongoDB (${mongoose.connection.host}, base «${mongoose.connection.name}»)`);
}

export async function desconectar() {
  await mongoose.disconnect();
  if (servidorLocal) await servidorLocal.stop({ doCleanup: false });
}
