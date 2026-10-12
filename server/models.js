import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const usuarioSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true },
    // Solo dígitos con código de país (51987654321). El bot lo usa para saber quién escribe y a quién enviar.
    whatsapp: { type: String, match: /^\d{10,15}$/ },
    // Libro sobre el que responde el bot; si falta, el primero del usuario.
    libroBot: { type: ObjectId, ref: 'Libro' },
    // Recuperación de contraseña: huella del código enviado, su caducidad y los intentos fallidos.
    codigoHash: String,
    codigoExpira: Date,
    codigoIntentos: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usuarioSchema.index({ whatsapp: 1 }, { unique: true, sparse: true });

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

// Ajustes del administrador (IA, bot), uno por clave.
const ajusteSchema = new Schema({ _id: String, valor: Schema.Types.Mixed }, { timestamps: true });

// Sesión de WhatsApp (credenciales y claves de cifrado), para no tener que escanear el QR en cada reinicio.
const sesionWaSchema = new Schema({ _id: String, datos: String });

export const Ajuste = model('Ajuste', ajusteSchema);
export const SesionWa = model('SesionWa', sesionWaSchema);
export const Usuario = model('Usuario', usuarioSchema);
export const Libro = model('Libro', libroSchema);
export const Movimiento = model('Movimiento', movimientoSchema);
