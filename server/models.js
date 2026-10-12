import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const usuarioSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

// Un "libro" agrupa movimientos. Cada usuario tiene los suyos y puede compartirlos.
const libroSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    moneda: { type: String, required: true, default: 'PEN', match: /^[A-Z]{3}$/ },
    propietario: { type: ObjectId, ref: 'Usuario', required: true, index: true },
    miembros: [
      {
        _id: false,
        usuario: { type: ObjectId, ref: 'Usuario', required: true },
        rol: { type: String, enum: ['lector', 'editor'], default: 'lector' },
      },
    ],
  },
  { timestamps: true },
);
libroSchema.index({ 'miembros.usuario': 1 });

const movimientoSchema = new Schema(
  {
    libro: { type: ObjectId, ref: 'Libro', required: true },
    tipo: { type: String, enum: ['gasto', 'ingreso'], required: true },
    descripcion: { type: String, required: true, trim: true, maxlength: 120 },
    categoria: { type: String, trim: true, maxlength: 40, default: 'General' },
    monto: { type: Number, required: true, min: 0.01 },
    // Fecha del movimiento o de vencimiento, siempre a medianoche UTC.
    fecha: { type: Date, required: true },
    pagado: { type: Boolean, default: false },
    fechaPago: { type: Date, default: null },
    // Movimientos creados juntos con "repetir cada mes" comparten la misma serie.
    serie: { type: ObjectId, default: null },
    creadoPor: { type: ObjectId, ref: 'Usuario' },
  },
  { timestamps: true },
);
movimientoSchema.index({ libro: 1, fecha: 1 });
movimientoSchema.index({ libro: 1, serie: 1 });

export const Usuario = model('Usuario', usuarioSchema);
export const Libro = model('Libro', libroSchema);
export const Movimiento = model('Movimiento', movimientoSchema);
