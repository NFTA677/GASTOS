import { mkdirSync, writeSync } from 'node:fs';
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

  const servidor = uri.replace(/^.*@/, '').replace(/[/?].*$/, '');
  console.log(`Conectando a MongoDB en ${servidor}...`);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    const causa = /auth/i.test(err.message)
      ? 'CAUSA PROBABLE: usuario o contraseña incorrectos (MONGODB_USER / MONGODB_PASSWORD).'
      : 'CAUSA PROBABLE: Atlas no permite la IP de este servidor. En Atlas, Network Access -> Add IP Address.';
    // writeSync garantiza que el mensaje llega al registro antes de cerrar el proceso.
    writeSync(2, `\nNo se pudo conectar a MongoDB: ${err.message}\n${causa}\n\n`);
    process.exit(1);
  }
  console.log(`Conectado a MongoDB (${mongoose.connection.host}, base «${mongoose.connection.name}»)`);
}

export async function desconectar() {
  await mongoose.disconnect();
  if (servidorLocal) await servidorLocal.stop({ doCleanup: false });
}
