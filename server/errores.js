export class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

// Lee un texto obligatorio del cuerpo de la petición (evita objetos tipo {$gt: ''}).
export function texto(valor, campo, max = 120) {
  if (typeof valor !== 'string' || !valor.trim()) throw new ErrorHttp(400, `Falta ${campo}`);
  const limpio = valor.trim();
  if (limpio.length > max) throw new ErrorHttp(400, `${campo} es demasiado largo`);
  return limpio;
}

// eslint-disable-next-line no-unused-vars
export function manejarErrores(err, req, res, next) {
  if (err instanceof ErrorHttp) return res.status(err.estado).json({ error: err.message });
  if (err.name === 'ValidationError' || err.name === 'CastError' || err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
