import { PassThrough } from 'node:stream';
import { config } from './config.js';
import { Libro, Movimiento } from './models.js';
import { generarInforme, formateador } from './informe.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------- fechas (el servidor va en UTC; «hoy» se decide en la zona horaria configurada) ----------

export const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.zona }).format(new Date());
const horaLocal = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.zona, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const aFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);
const diaMes = (fecha) => `${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()].slice(0, 3)}`;
const fechaLarga = (fecha) => `${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]} de ${fecha.getUTCFullYear()}`;

function sumarDias(texto, n) {
  const fecha = aFecha(texto);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return aTexto(fecha);
}

function moverMes(mes, n) {
  const [anio, m] = mes.split('-').map(Number);
  return aTexto(new Date(Date.UTC(anio, m - 1 + n, 1))).slice(0, 7);
}

// Primer y último día de un mes «AAAA-MM».
export function rangoMes(mes) {
  const desde = aFecha(`${mes}-01`);
  const hasta = aFecha(`${moverMes(mes, 1)}-01`);
  hasta.setUTCDate(0);
  return [desde, hasta];
}

const nombreMes = (mes) => `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

// «octubre de 2026» si el periodo es un mes completo; si no, «del 1 al 15 de octubre de 2026».
function nombrePeriodo(desde, hasta) {
  const [inicio, fin] = rangoMes(aTexto(desde).slice(0, 7));
  if (desde.getTime() === inicio.getTime() && hasta.getTime() === fin.getTime()) return nombreMes(aTexto(desde).slice(0, 7));
  return `del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
}

export function saludoSegunHora() {
  const hora = horaLocal();
  if (hora >= 5 && hora < 12) return 'Buenos días ☀️';
  if (hora >= 12 && hora < 19) return 'Buenas tardes 🌤️';
  return 'Buenas noches 🌙';
}

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

export const libroActivo = (usuario, libros) => libros.find((l) => l._id.equals(usuario.libroBot)) ?? libros[0];

function puedeEscribir(usuario, libro) {
  if (libro.propietario.equals(usuario._id)) return true;
  return libro.miembros.some((m) => m.usuario.equals(usuario._id) && m.rol === 'editor');
}

// Todo lo que el bot (o la IA) necesita saber de un libro para responder.
export async function datosDe(libro) {
  const hoy = hoyLocal();
  const mes = hoy.slice(0, 7);
  const proximo = moverMes(mes, 1);
  const anio = Number(mes.slice(0, 4));
  const entre = ([desde, hasta]) => ({ $gte: desde, $lte: hasta });

  const [delMes, delProximo, pendientes, delAnio] = await Promise.all([
    Movimiento.find({ libro: libro._id, fecha: entre(rangoMes(mes)) }).sort('fecha').lean(),
    Movimiento.find({ libro: libro._id, fecha: entre(rangoMes(proximo)) }).sort('fecha').lean(),
    Movimiento.find({ libro: libro._id, pagado: false, fecha: { $lte: aFecha(sumarDias(hoy, 30)) } }).sort('fecha').limit(60).lean(),
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

function textoTotales(titulo, libro, t, dinero) {
  return [
    titulo,
    `Libro: ${libro.nombre}`,
    '',
    `Ingresos: *${dinero(t.ingresos)}*${t.ingresosPendientes ? ` (${dinero(t.ingresosPendientes)} por recibir)` : ''}`,
    `Gastos: *${dinero(t.gastos)}*`,
    `Balance: *${dinero(t.balance)}*`,
    `Falta por pagar: *${dinero(t.gastosPendientes)}*`,
  ].join('\n');
}

const textoResumen = (libro, d, dinero) => textoTotales(`📊 *Estado de cuenta · ${nombreMes(d.mes)}*`, libro, d.totalMes, dinero);
const textoAnio = (libro, d, dinero) => textoTotales(`📅 *Año ${d.anio}*`, libro, d.totalAnio, dinero);

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
  const gastos = d.delProximo.filter((m) => m.tipo === 'gasto');
  return [
    textoTotales(`🗓️ *Previsión · ${nombreMes(d.proximo)}*`, libro, d.totalProximo, dinero),
    ...(gastos.length ? ['', '*Pagos programados*', ...gastos.slice(0, 20).map((m) => lineaMovimiento(m, dinero, d.hoy))] : []),
  ].join('\n');
}

const AYUDA_REGISTRAR = [
  '✍️ *Registrar un movimiento*',
  'Escribe el tipo, el monto y una descripción:',
  '• *gasto 25.50 almuerzo*',
  '• *ingreso 1200 salario*',
  '',
  'Opcional: una fecha (*ayer*, *mañana* o *15/10*), la categoría con # (*#comida*) y la palabra *pendiente* si aún no está pagado.',
  'Ejemplo: *gasto 110 internet 28/10 #servicios pendiente*',
  '',
  'Si te equivocas, escribe *deshacer*.',
].join('\n');

// Saludo con menú numerado; durante unos minutos se puede contestar solo con el número.
const OPCIONES_MENU = ['resumen', 'deudas', 'proximo', 'anio', 'pdf', 'registrar', 'libros'];
const menuReciente = new Map();
const MINUTOS_MENU = 15;

export function textoMenu(usuario, libro, conIa) {
  menuReciente.set(usuario.id, Date.now());
  return [
    `¡Hola, ${usuario.nombre}! ${saludoSegunHora()}`,
    'Soy tu asistente de *N.F.T.A Gastos*. ¿Qué quieres hacer hoy?',
    '',
    '1️⃣ Ver el *resumen* del mes',
    '2️⃣ Ver mis *deudas* y pagos pendientes',
    '3️⃣ Ver la previsión del *próximo* mes',
    '4️⃣ Ver los totales del *año*',
    '5️⃣ Recibir el informe en *PDF*',
    '6️⃣ *Registrar* un gasto o un ingreso',
    '7️⃣ Cambiar de *libro*',
    '',
    `Respóndeme con el número o con la palabra. Libro actual: *${libro.nombre}*.`,
    ...(conIa ? ['', 'También puedes escribirme con tus propias palabras empezando por *ia*, por ejemplo: «ia gasté 30 soles en taxi ayer» o «ia mándame el PDF de septiembre».'] : []),
  ].join('\n');
}

// ---------- informes ----------

function pdfBuffer(libro, desde, hasta, movimientos) {
  const trozos = [];
  const flujo = new PassThrough();
  flujo.on('data', (trozo) => trozos.push(trozo));
  const listo = new Promise((resolve, reject) => flujo.on('end', resolve).on('error', reject));
  generarInforme(flujo, { libro, desde, hasta, movimientos });
  return listo.then(() => Buffer.concat(trozos));
}

/**
 * Estado de cuenta de un periodo cualquiera: texto con los totales y el PDF con el detalle.
 * Lo usan el bot, la IA y el envío desde «Compartir».
 */
export async function informePeriodo(libro, desde, hasta) {
  const movimientos = await Movimiento.find({ libro: libro._id, fecha: { $gte: desde, $lte: hasta } }).sort({ fecha: 1, createdAt: 1 }).limit(10000).lean();
  const periodo = nombrePeriodo(desde, hasta);
  const dinero = formateador(libro.moneda);
  return {
    periodo,
    texto: textoTotales(`📊 *Estado de cuenta · ${periodo}*`, libro, totales(movimientos), dinero),
    pdf: { nombre: `Gastos ${libro.nombre} ${periodo}.pdf`.replace(/[\\/:*?"<>|]/g, ''), buffer: await pdfBuffer(libro, desde, hasta, movimientos) },
  };
}

// ---------- registrar movimientos ----------

// Último movimiento creado por el bot para cada usuario, por si pide deshacerlo.
const ultimoRegistrado = new Map();

/**
 * Crea un movimiento a petición del usuario (por comando o a través de la IA) y devuelve la confirmación.
 * Valida todo aquí: lo que llega puede venir de un modelo de lenguaje.
 */
export async function registrarMovimiento(usuario, libro, datos, extra = {}) {
  if (!puedeEscribir(usuario, libro)) return `🔒 En el libro *${libro.nombre}* solo tienes permiso de lectura; no puedo registrar nada ahí.`;

  const hoy = hoyLocal();
  const tipo = datos.tipo === 'ingreso' ? 'ingreso' : datos.tipo === 'gasto' ? 'gasto' : null;
  const monto = Math.round(Number(datos.monto) * 100) / 100;
  const fechaTexto = typeof datos.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) ? datos.fecha : hoy;
  const fecha = aFecha(fechaTexto);
  if (!tipo) return 'No me quedó claro si es un gasto o un ingreso.';
  if (!Number.isFinite(monto) || monto <= 0 || monto > 1e9) return 'Necesito un monto válido, mayor que cero.';
  if (Number.isNaN(fecha.getTime()) || Math.abs(fecha - aFecha(hoy)) > 5 * 366 * 86400000) return 'La fecha no es válida.';

  const limpiar = (valor, max, porDefecto) => (typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, max) : porDefecto);
  // Sin indicación expresa: lo de hoy o antes se da por pagado y lo futuro queda pendiente.
  const pagado = typeof datos.pagado === 'boolean' ? datos.pagado : fechaTexto <= hoy;

  const mov = await Movimiento.create({
    libro: libro._id,
    tipo,
    descripcion: limpiar(datos.descripcion, 120, tipo === 'gasto' ? 'Gasto por WhatsApp' : 'Ingreso por WhatsApp'),
    categoria: limpiar(datos.categoria, 40, 'General'),
    monto,
    fecha,
    pagado,
    fechaPago: pagado ? new Date() : null,
    creadoPor: usuario._id,
    ...(extra.correoId && { correoId: extra.correoId }),
  });
  ultimoRegistrado.set(usuario.id, { id: mov._id, cuando: Date.now() });

  const dinero = formateador(libro.moneda);
  const estado = tipo === 'gasto' ? (pagado ? 'pagado' : 'pendiente de pago') : pagado ? 'recibido' : 'por recibir';
  return [
    `✅ *${tipo === 'gasto' ? 'Gasto' : 'Ingreso'} registrado* en ${libro.nombre}`,
    `${mov.descripcion}: *${dinero(monto)}*`,
    `${fechaLarga(fecha)} · ${mov.categoria} · ${estado}`,
    'Si no es correcto, escribe *deshacer*.',
  ].join('\n');
}

export async function deshacerUltimo(usuario) {
  const ultimo = ultimoRegistrado.get(usuario.id);
  if (!ultimo || Date.now() - ultimo.cuando > 24 * 3600 * 1000) return 'No tengo ningún registro reciente tuyo que deshacer. Para borrar otros movimientos usa la app.';
  const mov = await Movimiento.findOneAndDelete({ _id: ultimo.id, creadoPor: usuario._id });
  ultimoRegistrado.delete(usuario.id);
  return mov ? `↩️ Borrado: ${mov.descripcion} (${mov.monto}).` : 'Ese movimiento ya no existe.';
}

// ---------- comandos ----------

const sinAcentos = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COMANDOS = [
  { accion: 'menu', palabras: ['hola', 'holi', 'buenas', 'buenos', 'buen', 'hey', 'menu', 'ayuda', 'help', 'inicio', 'opciones', 'comandos'] },
  { accion: 'resumen', palabras: ['resumen', 'estado', 'saldo', 'balance', 'mes', 'cuenta'] },
  { accion: 'deudas', palabras: ['deudas', 'deuda', 'pendientes', 'pendiente', 'pagos', 'debo', 'vencidos'] },
  { accion: 'proximo', palabras: ['proximo', 'siguiente', 'prevision'] },
  { accion: 'anio', palabras: ['ano', 'anual', 'anio'] },
  { accion: 'pdf', palabras: ['pdf', 'informe', 'reporte'] },
  { accion: 'registrar', palabras: ['registrar', 'anotar', 'agregar'] },
  // Solo la palabra exacta: borrar algo no debe dispararse con un mensaje corriente.
  { accion: 'deshacer', palabras: ['deshacer'] },
  { accion: 'libros', palabras: ['libros', 'libro'] },
];

const TIPOS_REGISTRO = { gasto: 'gasto', gaste: 'gasto', pague: 'gasto', ingreso: 'ingreso', cobre: 'ingreso', recibi: 'ingreso' };

// «25», «25.50», «25,5», «S/30», «1,200», «1.200,50», «1,200.50» → número; null si no es un monto.
function leerMonto(ficha) {
  const texto = ficha.replace(/^(s\/\.?|\$|€)/i, '');
  let normal;
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(texto)) {
    // Con separador de miles: el último signo solo es decimal si le siguen una o dos cifras.
    const decimales = /[.,]\d{1,2}$/.exec(texto)?.[0] ?? '';
    normal = texto.slice(0, texto.length - decimales.length).replace(/[.,]/g, '') + decimales.replace(',', '.');
  } else if (/^\d{1,9}([.,]\d{1,2})?$/.test(texto)) {
    normal = texto.replace(',', '.');
  } else {
    return null;
  }
  return Number(normal);
}

// «gasto 25.50 almuerzo ayer #comida pendiente» → datos del movimiento, o null si no es un registro.
function leerRegistro(mensaje, hoy) {
  const fichas = mensaje.trim().split(/\s+/);
  const tipo = TIPOS_REGISTRO[sinAcentos(fichas[0] ?? '')];
  if (!tipo) return null;
  // El monto debe venir entre las primeras palabras; si no, es una frase normal que empieza por «gasto».
  const posMonto = fichas.findIndex((f, i) => i >= 1 && i <= 3 && leerMonto(f) !== null);
  if (posMonto === -1) return null;

  const datos = { tipo, monto: leerMonto(fichas[posMonto]) };
  const descripcion = [];
  fichas.forEach((ficha, i) => {
    if (i === 0 || i === posMonto) return;
    const llana = sinAcentos(ficha);
    const dia = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(ficha);
    if (llana === 'hoy') datos.fecha = hoy;
    else if (llana === 'ayer') datos.fecha = sumarDias(hoy, -1);
    else if (llana === 'anteayer') datos.fecha = sumarDias(hoy, -2);
    else if (llana === 'manana') datos.fecha = sumarDias(hoy, 1);
    else if (dia) {
      const anio = dia[3] ? (dia[3].length === 2 ? `20${dia[3]}` : dia[3]) : hoy.slice(0, 4);
      datos.fecha = `${anio}-${dia[2].padStart(2, '0')}-${dia[1].padStart(2, '0')}`;
    } else if (llana === 'pendiente') datos.pagado = false;
    else if (llana === 'pagado' || llana === 'recibido') datos.pagado = true;
    else if (ficha.startsWith('#') && ficha.length > 1) datos.categoria = ficha[1].toUpperCase() + ficha.slice(2);
    // Palabras de relleno al principio: «gasté 30 en taxi», «soles».
    else if (!(descripcion.length === 0 && ['en', 'de', 'por', 'soles', 'sol', 'dolares'].includes(llana))) descripcion.push(ficha);
  });
  if (descripcion.length) datos.descripcion = descripcion.join(' ').replace(/^./, (c) => c.toUpperCase());
  return datos;
}

// Solo los mensajes cortos se tratan como comandos; lo demás es conversación (para la IA o para ignorar).
function reconocer(usuario, texto) {
  const palabras = sinAcentos(texto).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(Boolean);
  if (palabras.length === 0 || palabras.length > 3) return null;
  // Un número suelto vale como opción del menú si se mostró hace poco.
  if (palabras.length === 1 && /^[1-7]$/.test(palabras[0]) && Date.now() - (menuReciente.get(usuario.id) ?? 0) < MINUTOS_MENU * 60000) {
    return { accion: OPCIONES_MENU[Number(palabras[0]) - 1], resto: [] };
  }
  const comando = COMANDOS.find((c) => c.palabras.includes(palabras[0]));
  return comando ? { accion: comando.accion, resto: palabras.slice(1) } : null;
}

/**
 * Responde a un mensaje de un usuario registrado.
 * Devuelve { texto, pdf? } si era un comando, o null si no lo era.
 */
export async function responder(usuario, mensaje, { conIa = false } = {}) {
  const hoy = hoyLocal();
  const registro = leerRegistro(mensaje, hoy);
  const comando = registro ? { accion: 'crear' } : reconocer(usuario, mensaje);
  if (!comando) return null;

  const libros = await librosDe(usuario);
  if (libros.length === 0) return { texto: 'Todavía no tienes ningún libro. Entra en la app y crea uno.' };
  let libro = libroActivo(usuario, libros);

  if (comando.accion === 'crear') return { texto: await registrarMovimiento(usuario, libro, registro) };
  if (comando.accion === 'registrar') return { texto: AYUDA_REGISTRAR };
  if (comando.accion === 'deshacer') return { texto: await deshacerUltimo(usuario) };
  if (comando.accion === 'menu') return { texto: textoMenu(usuario, libro, conIa) };

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

  if (comando.accion === 'pdf') {
    const desplazamiento = { pasado: -1, anterior: -1, siguiente: 1, proximo: 1 }[comando.resto[0]] ?? 0;
    const { texto, pdf } = await informePeriodo(libro, ...rangoMes(moverMes(hoy.slice(0, 7), desplazamiento)));
    return { texto, pdf };
  }

  const dinero = formateador(libro.moneda);
  const datos = await datosDe(libro);
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

// ---------- IA: contexto y ejecución de lo que pide ----------

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
    puedeRegistrar: puedeEscribir(usuario, libro),
    hoy: d.hoy,
    saludoPorLaHora: saludoSegunHora(),
    mesActual: { mes: d.mes, totales: d.totalMes, movimientos: d.delMes.slice(0, 200).map(corto) },
    mesSiguiente: { mes: d.proximo, totales: d.totalProximo, movimientos: d.delProximo.slice(0, 100).map(corto) },
    pendientesVencidosYProximos30Dias: d.pendientes.map(corto),
    totalesDelAnio: { anio: d.anio, ...d.totalAnio },
  };
}

/**
 * Ejecuta las acciones que propuso la IA, validándolas una a una.
 * Devuelve los textos de confirmación y los PDF que hay que enviar.
 */
export async function ejecutarAcciones(usuario, acciones) {
  const textos = [];
  const pdfs = [];
  if (!Array.isArray(acciones) || acciones.length === 0) return { textos, pdfs };

  const libro = libroActivo(usuario, await librosDe(usuario));
  if (!libro) return { textos, pdfs };

  // Como mucho unas pocas acciones por mensaje: un modelo confundido no debe llenar el libro.
  for (const accion of acciones.slice(0, 5)) {
    if (accion?.tipo === 'registrar' && accion.movimiento && typeof accion.movimiento === 'object') {
      textos.push(await registrarMovimiento(usuario, libro, accion.movimiento));
    } else if (accion?.tipo === 'deshacer') {
      textos.push(await deshacerUltimo(usuario));
    } else if (accion?.tipo === 'pdf' && pdfs.length < 2) {
      const valida = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(aFecha(f).getTime());
      const [mesDesde, mesHasta] = rangoMes(hoyLocal().slice(0, 7));
      const desde = valida(accion.desde) ? aFecha(accion.desde) : mesDesde;
      const hasta = valida(accion.hasta) ? aFecha(accion.hasta) : mesHasta;
      if (hasta >= desde && hasta - desde <= 3 * 366 * 86400000) pdfs.push(await informePeriodo(libro, desde, hasta));
    }
  }
  return { textos, pdfs };
}
