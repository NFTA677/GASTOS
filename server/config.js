import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se usan los valores por defecto.
}

// La clave de sesión debe sobrevivir a los reinicios, así que se guarda en .env la primera vez.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  appendFileSync('.env', `\nJWT_SECRET=${process.env.JWT_SECRET}\n`);
}

// La conexión se puede dar entera (MONGODB_URI) o por partes (usuario, contraseña, servidor).
function uriDeMongo() {
  const dato = (nombre) => process.env[nombre]?.trim() || '';
  if (dato('MONGODB_URI')) return dato('MONGODB_URI');

  const host = dato('MONGODB_HOST').replace(/^mongodb(\+srv)?:\/\//, '').replace(/\/.*$/, '');
  if (!host) return '';
  // Atlas usa nombres tipo cluster0.xxxxx.mongodb.net (srv); un servidor con puerto o local, no.
  const local = host.includes(':') || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host);
  const usuario = dato('MONGODB_USER');
  // encodeURIComponent permite contraseñas con símbolos como @ : / #
  const acceso = usuario ? `${encodeURIComponent(usuario)}:${encodeURIComponent(dato('MONGODB_PASSWORD'))}@` : '';
  const base = dato('MONGODB_DB') || 'gastos';
  return `${local ? 'mongodb' : 'mongodb+srv'}://${acceso}${host}/${base}?retryWrites=true&w=majority`;
}

export const config = {
  puerto: Number(process.env.PORT) || 3000,
  mongoUri: uriDeMongo(),
  jwtSecret: process.env.JWT_SECRET,
  produccion: process.env.NODE_ENV === 'production',
};
