import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { conectar, desconectar } from './db.js';
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

app.use('/api/auth', rutasAuth);
app.use('/api', requiereSesion, rutasApi);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(express.static(publico));
app.use(manejarErrores);

await conectar();
const servidor = app.listen(config.puerto, () => {
  console.log(`Registro de gastos listo en http://localhost:${config.puerto}`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    servidor.close();
    await desconectar();
    process.exit(0);
  });
}
