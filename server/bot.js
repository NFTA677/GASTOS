import { PassThrough } from 'node:stream';
import { config } from './config.js';
import { Libro, Movimiento } from './models.js';
import { generarInforme, formateador } from './informe.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------- fechas (el servidor va en UTC; «hoy» se decide en la zona horaria configurada) ----------

export const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.zona }).format(new Date());
const aFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);
const diaMes = (fecha) => `${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()].slice(0, 3)}`;

function moverMes(mes, n) {
  const [anio, m] = mes.split('-').map(Number);
  return aTexto(new Date(Date.UTC(anio, m - 1 + n, 1))).slice(0, 7);
}

// Primer y último día de un mes «AAAA-MM».
function rangoMes(mes) {
  const desde = aFecha(`${mes}-01`);
  const hasta = aFecha(`${moverMes(mes, 1)}-01`);
  hasta.setUTCDate(0);
  return [desde, hasta];
}

const nombreMes = (mes) => `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

// ---------- datos ----------

function totales(movimientos) {
  const t = { ingresos: 0, gastos: 0, gastosPendientes: 0, ingresosPendientes: 0 };
  for (const m of movimientos) {
    if (m.tipo === 'gasto') {
      t.gastos += m.monto;
      if (!m.pagado) t.gastosPendientes += m.monto;
    } else {
      t.ingresos += m.monto;
      if (!m.pagado) t.ingresosPendientes += m.monto;
    }
  }
  for (const clave of Object.keys(t)) t[clave] = Math.round(t[clave] * 100) / 100;
  t.balance = Math.round((t.ingresos - t.gastos) * 100) / 100;
  return t;
}

// Libros a los que el usuario tiene acceso, los propios primero.
export async function librosDe(usuario) {
  const libros = await Libro.find({ $or: [{ propietario: usuario._id }, { 'miembros.usuario': usuario._id }] }).sort('createdAt');
  return [...libros.filter((l) => l.propietario.equals(usuario._id)), ...libros.filter((l) => !l.propietario.equals(usuario._id))];
}

const libroActivo = (usuario, libros) => libros.find((l) => l._id.equals(usuario.libroBot)) ?? libros[0];

// Todo lo que el bot (o la IA) necesita saber de un libro para responder.
export async function datosDe(libro) {
  const hoy = hoyLocal();
  const mes = hoy.slice(0, 7);
  const proximo = moverMes(mes, 1);
  const anio = Number(mes.slice(0, 4));
  const entre = ([desde, hasta]) => ({ $gte: desde, $lte: hasta });
  const limite = aFecha(hoy);
  limite.setUTCDate(limite.getUTCDate() + 30);

  const [delMes, delProximo, pendientes, delAnio] = await Promise.all([
    Movimiento.find({ libro: libro._id, fecha: entre(rangoMes(mes)) }).sort('fecha').lean(),
    Movimiento.find({ libro: libro._id, fecha: entre(rangoMes(proximo)) }).sort('fecha').lean(),
    Movimiento.find({ libro: libro._id, pagado: false, fecha: { $lte: limite } }).sort('fecha').limit(60).lean(),
    Movimiento.find({ libro: libro._id, fecha: { $gte: new Date(Date.UTC(anio, 0, 1)), $lt: new Date(Date.UTC(anio + 1, 0, 1)) } })
      .select('tipo monto pagado')
      .lean(),
  ]);

  return { hoy, mes, proximo, anio, delMes, delProximo, pendientes, totalMes: totales(delMes), totalProximo: totales(delProximo), totalAnio: totales(delAnio) };
}

// ---------- textos (formato de WhatsApp: *negrita*) ----------

function lineaMovimiento(m, dinero, hoy) {
  const vencido = !m.pagado && aTexto(m.fecha) < hoy;
  return `• ${diaMes(m.fecha)} — ${m.descripcion}: ${m.tipo === 'gasto' ? '-' : '+'}${dinero(m.monto)}${vencido ? ' ⚠️ vencido' : ''}`;
}

function textoResumen(libro, d, dinero) {
  const t = d.totalMes;
  return [
    `📊 *Estado de cuenta · ${nombreMes(d.mes)}*`,
    `Libro: ${libro.nombre}`,
    '',
    `Ingresos: *${dinero(t.ingresos)}*${t.ingresosPendientes ? ` (${dinero(t.ingresosPendientes)} por recibir)` : ''}`,
    `Gastos: *${dinero(t.gastos)}*`,
    `Balance: *${dinero(t.balance)}*`,
    `Falta por pagar: *${dinero(t.gastosPendientes)}*`,
  ].join('\n');
}

function textoDeudas(libro, d, dinero) {
  const deudas = d.pendientes.filter((m) => m.tipo === 'gasto');
  const cobros = d.pendientes.filter((m) => m.tipo === 'ingreso');
  if (deudas.length === 0 && cobros.length === 0) return `✅ *${libro.nombre}*: no tienes pagos ni cobros pendientes en los próximos 30 días.`;

  const suma = (lista) => lista.reduce((total, m) => total + m.monto, 0);
  const vencidas = deudas.filter((m) => aTexto(m.fecha) < d.hoy);
  const lineas = [`💳 *Pagos pendientes · ${libro.nombre}*`, 'Vencidos y próximos 30 días', ''];
  if (deudas.length) {
    lineas.push(...deudas.slice(0, 25).map((m) => lineaMovimiento(m, dinero, d.hoy)));
    if (deudas.length > 25) lineas.push(`… y ${deudas.length - 25} más`);
    lineas.push('', `Total por pagar: *${dinero(suma(deudas))}*`);
    if (vencidas.length) lineas.push(`De eso, ya vencido: *${dinero(suma(vencidas))}* (${vencidas.length})`);
  } else {
    lineas.push('No tienes pagos pendientes. ✅');
  }
  if (cobros.length) {
    lineas.push('', '*Por cobrar*', ...cobros.slice(0, 10).map((m) => lineaMovimiento(m, dinero, d.hoy)), `Total por cobrar: *${dinero(suma(cobros))}*`);
  }
  return lineas.join('\n');
}

function textoProximo(libro, d, dinero) {
  const t = d.totalProximo;
  const gastos = d.delProximo.filter((m) => m.tipo === 'gasto');
  return [
    `🗓️ *Previsión · ${nombreMes(d.proximo)}*`,
    `Libro: ${libro.nombre}`,
    '',
    `Ingresos previstos: *${dinero(t.ingresos)}*`,
    `Gastos previstos: *${dinero(t.gastos)}*`,
    `Balance previsto: *${dinero(t.balance)}*`,
    ...(gastos.length ? ['', '*Pagos programados*', ...gastos.slice(0, 20).map((m) => lineaMovimiento(m, dinero, d.hoy))] : []),
  ].join('\n');
}

function textoAnio(libro, d, dinero) {
  const t = d.totalAnio;
  return [
    `📅 *Año ${d.anio} · ${libro.nombre}*`,
    '',
    `Ingresos: *${dinero(t.ingresos)}*`,
    `Gastos: *${dinero(t.gastos)}*`,
    `Balance: *${dinero(t.balance)}*`,
    `Falta por pagar: *${dinero(t.gastosPendientes)}*`,
  ].join('\n');
}

export function textoMenu(usuario, libro, conIa) {
  return [
    `🤖 *N.F.T.A Gastos* — Hola, ${usuario.nombre}`,
    `Libro: ${libro.nombre}`,
    '',
    'Escríbeme una de estas palabras:',
    '• *resumen* — estado de cuenta del mes',
    '• *deudas* — pagos pendientes y vencidos',
    '• *proximo* — previsión del mes siguiente',
    '• *año* — totales del año',
    '• *pdf* — informe del mes en PDF (también «pdf pasado» o «pdf siguiente»)',
    '• *libros* — ver o cambiar de libro',
    ...(conIa ? ['', 'También puedes preguntarme con tus palabras empezando por *ia*, por ejemplo: «ia ¿cuánto gasté en comida este mes?»'] : []),
  ].join('\n');
}

function pdfDe(libro, mes, movimientos) {
  const [desde, hasta] = rangoMes(mes);
  const trozos = [];
  const flujo = new PassThrough();
  flujo.on('data', (trozo) => trozos.push(trozo));
  const listo = new Promise((resolve, reject) => flujo.on('end', resolve).on('error', reject));
  generarInforme(flujo, { libro, desde, hasta, movimientos });
  return listo.then(() => ({ nombre: `Gastos ${libro.nombre} ${nombreMes(mes)}.pdf`, buffer: Buffer.concat(trozos) }));
}

// ---------- comandos ----------

const sinAcentos = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COMANDOS = [
  { accion: 'menu', palabras: ['hola', 'menu', 'ayuda', 'help', 'inicio', 'opciones', 'comandos'] },
  { accion: 'resumen', palabras: ['resumen', 'estado', 'saldo', 'balance', 'mes', 'cuenta'] },
  { accion: 'deudas', palabras: ['deudas', 'deuda', 'pendientes', 'pendiente', 'pagos', 'debo', 'vencidos'] },
  { accion: 'proximo', palabras: ['proximo', 'siguiente', 'prevision'] },
  { accion: 'anio', palabras: ['ano', 'anual', 'anio'] },
  { accion: 'pdf', palabras: ['pdf', 'informe', 'reporte'] },
  { accion: 'libros', palabras: ['libros', 'libro'] },
];

// Solo los mensajes cortos se tratan como comandos; lo demás es conversación (para la IA o para ignorar).
function reconocer(texto) {
  const palabras = sinAcentos(texto).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(Boolean);
  if (palabras.length === 0 || palabras.length > 3) return null;
  const comando = COMANDOS.find((c) => c.palabras.includes(palabras[0]));
  return comando ? { accion: comando.accion, resto: palabras.slice(1) } : null;
}

/**
 * Responde a un mensaje de un usuario registrado.
 * Devuelve { texto, pdf? } si era un comando, o null si no lo era.
 */
export async function responder(usuario, mensaje, { conIa = false } = {}) {
  const comando = reconocer(mensaje);
  if (!comando) return null;

  const libros = await librosDe(usuario);
  if (libros.length === 0) return { texto: 'Todavía no tienes ningún libro. Entra en la app y crea uno.' };
  let libro = libroActivo(usuario, libros);

  if (comando.accion === 'libros') {
    const elegido = Number(comando.resto[0]);
    if (Number.isInteger(elegido) && elegido >= 1 && elegido <= libros.length) {
      libro = libros[elegido - 1];
      usuario.libroBot = libro._id;
      await usuario.save();
      return { texto: `✅ Ahora te respondo sobre el libro *${libro.nombre}*.` };
    }
    return {
      texto: ['📚 *Tus libros*', ...libros.map((l, i) => `${i + 1}. ${l.nombre} (${l.moneda})${l._id.equals(libro._id) ? ' ← actual' : ''}`), '', 'Para cambiar escribe, por ejemplo: *libro 2*'].join('\n'),
    };
  }
  if (comando.accion === 'menu') return { texto: textoMenu(usuario, libro, conIa) };

  const dinero = formateador(libro.moneda);
  const datos = await datosDe(libro);

  if (comando.accion === 'pdf') {
    const desplazamiento = { pasado: -1, anterior: -1, siguiente: 1, proximo: 1 }[comando.resto[0]] ?? 0;
    const mes = moverMes(datos.mes, desplazamiento);
    const movimientos = desplazamiento === 0
      ? datos.delMes
      : await Movimiento.find({ libro: libro._id, fecha: { $gte: rangoMes(mes)[0], $lte: rangoMes(mes)[1] } }).sort('fecha').lean();
    return { texto: `📄 Informe de ${nombreMes(mes)} · ${libro.nombre}`, pdf: await pdfDe(libro, mes, movimientos) };
  }

  const textos = { resumen: textoResumen, deudas: textoDeudas, proximo: textoProximo, anio: textoAnio };
  return { texto: textos[comando.accion](libro, datos, dinero) };
}

// Estado de cuenta que el administrador envía por iniciativa propia: resumen del mes más los pagos pendientes.
export async function estadoDeCuenta(usuario) {
  const libros = await librosDe(usuario);
  if (libros.length === 0) return null;
  const libro = libroActivo(usuario, libros);
  const dinero = formateador(libro.moneda);
  const datos = await datosDe(libro);
  return [textoResumen(libro, datos, dinero), '', textoDeudas(libro, datos, dinero), '', 'Escribe *menu* para ver más opciones.'].join('\n');
}

// Contexto compacto para la IA: totales y movimientos del libro activo.
export async function contextoParaIa(usuario) {
  const libros = await librosDe(usuario);
  if (libros.length === 0) return null;
  const libro = libroActivo(usuario, libros);
  const d = await datosDe(libro);
  const corto = (m) => ({ fecha: aTexto(m.fecha), tipo: m.tipo, descripcion: m.descripcion, categoria: m.categoria, monto: m.monto, pagado: m.pagado });
  return {
    libro: libro.nombre,
    moneda: libro.moneda,
    hoy: d.hoy,
    mesActual: { mes: d.mes, totales: d.totalMes, movimientos: d.delMes.slice(0, 200).map(corto) },
    mesSiguiente: { mes: d.proximo, totales: d.totalProximo, movimientos: d.delProximo.slice(0, 100).map(corto) },
    pendientesVencidosYProximos30Dias: d.pendientes.map(corto),
    totalesDelAnio: { anio: d.anio, ...d.totalAnio },
  };
}
