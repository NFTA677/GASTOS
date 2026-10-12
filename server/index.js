import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { conectar, desconectar, estadoBd } from './db.js';
import { rutasAuth, requiereSesion } from './auth.js';
import { rutasApi } from './routes.js';
import { manejarErrores } from './errores.js';

const publico = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.disable('x-powered-by');
// En el hosting la app va detrás de un proxy: sin esto el límite de intentos vería a todos con la misma IP.
if (config.produccion) app.set('trust proxy', 1);
// Sin upgrade-insecure-requests para que funcione por http en la red local.
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// Sin base de datos la página sigue abriendo y la API explica qué pasa.
app.use('/api', (req, res, next) => {
  if (estadoBd.lista) return next();
  res.status(503).json({ error: `Sin conexión con la base de datos. ${estadoBd.causa}` });
});
app.use('/api/auth', rutasAuth);
app.use('/api', requiereSesion, rutasApi);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(express.static(publico));
app.use(manejarErrores);

// Primero se abre el puerto (el hosting lo exige para dar el servicio por arrancado) y luego la base.
const servidor = app.listen(config.puerto, () => {
  console.log(`Registro de gastos escuchando en http://localhost:${config.puerto}`);
});
conectar().catch((err) => {
  estadoBd.causa = 'No se pudo iniciar la base de datos local.';
  console.error('No se pudo iniciar MongoDB:', err.message);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    servidor.close();
    await desconectar();
    process.exit(0);
  });
}
