import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Usuario, Libro, Movimiento } from './models.js';
import { crearUsuario } from './auth.js';
import { ErrorHttp } from './errores.js';

const BASES_DEL_SISTEMA = ['admin', 'local', 'config'];

// El límite del plan se aplica a todo el clúster, así que se suman todas sus bases de datos.
// Si el usuario de MongoDB no tiene permiso para listarlas, se mide solo la de esta app.
async function usoDelCluster() {
  const cliente = mongoose.connection.getClient();
  let nombres = [mongoose.connection.name];
  let completo = false;
  try {
    const { databases } = await cliente.db().admin().listDatabases({ nameOnly: true });
    nombres = databases.map((d) => d.name).filter((n) => !BASES_DEL_SISTEMA.includes(n));
    if (!nombres.includes(mongoose.connection.name)) nombres.push(mongoose.connection.name);
    completo = true;
  } catch {
    // Sin permiso: se sigue con la base propia.
  }

  const bases = [];
  for (const nombre of nombres) {
    const s = await cliente.db(nombre).stats();
    bases.push({ nombre, bytes: s.dataSize + s.indexSize, documentos: s.objects, propia: nombre === mongoose.connection.name });
  }
  return { bases, completo };
}

export const rutasAdmin = Router();

rutasAdmin.get('/almacenamiento', async (req, res) => {
  const [{ bases, completo }, usuarios, libros, movimientos, statsMov] = await Promise.all([
    usoDelCluster(),
    Usuario.countDocuments(),
    Libro.countDocuments(),
    Movimiento.countDocuments(),
    mongoose.connection.db.command({ collStats: Movimiento.collection.name }).catch(() => null),
  ]);

  const limite = config.almacenamientoMb * 1024 * 1024;
  const usado = bases.reduce((total, b) => total + b.bytes, 0);
  const libre = Math.max(0, limite - usado);
  // Tamaño medio de un movimiento con sus índices. Con pocos datos la media engaña
  // (los índices tienen un tamaño mínimo), así que hasta 1000 movimientos se usa un valor fijo prudente.
  const porMovimiento = movimientos >= 1000 && statsMov ? (statsMov.size + statsMov.totalIndexSize) / movimientos : 400;

  res.json({
    limite,
    usado,
    libre,
    porcentaje: Math.min(100, (usado / limite) * 100),
    movimientosQueCaben: Math.floor(libre / porMovimiento),
    clusterCompleto: completo,
    bases: bases.sort((a, b) => b.bytes - a.bytes),
    totales: { usuarios, libros, movimientos },
  });
});

rutasAdmin.post('/usuarios', async (req, res) => {
  const usuario = await crearUsuario(req.body);
  res.status(201).json({ usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email } });
});

// Elimina la cuenta con sus libros y movimientos, y la quita de los libros que le compartieron.
rutasAdmin.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario.id) throw new ErrorHttp(400, 'No puedes eliminar tu propia cuenta desde aquí');
  const usuario = mongoose.isValidObjectId(id) ? await Usuario.findById(id) : null;
  if (!usuario) throw new ErrorHttp(404, 'Usuario no encontrado');

  const libros = await Libro.find({ propietario: usuario._id }).distinct('_id');
  const { deletedCount: movimientos } = await Movimiento.deleteMany({ libro: { $in: libros } });
  await Libro.deleteMany({ _id: { $in: libros } });
  await Libro.updateMany({ 'miembros.usuario': usuario._id }, { $pull: { miembros: { usuario: usuario._id } } });
  await usuario.deleteOne();
  res.json({ eliminado: { nombre: usuario.nombre, libros: libros.length, movimientos } });
});

rutasAdmin.get('/usuarios', async (req, res) => {
  const [usuarios, librosPorUsuario] = await Promise.all([
    Usuario.find().sort({ createdAt: 1 }).select('nombre email createdAt').limit(500),
    Libro.aggregate([{ $group: { _id: '$propietario', total: { $sum: 1 } } }]),
  ]);
  const libros = new Map(librosPorUsuario.map((l) => [String(l._id), l.total]));
  res.json({
    usuarios: usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      registro: u.createdAt.toISOString().slice(0, 10),
      libros: libros.get(u.id) ?? 0,
    })),
  });
});
