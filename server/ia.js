import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { Ajuste } from './models.js';

export const MODELOS = {
  'claude-opus-5-5': 'Claude Opus 5.5 (el más capaz)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (equilibrado)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (el más económico)',
};
const MODELO_POR_DEFECTO = 'claude-opus-5-5';
// Modelos que admiten el modelo de respaldo automático cuando el principal declina responder.
const CON_RESPALDO = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const MAX_PREGUNTAS_DIA = 40;
const TURNOS_RECORDADOS = 6;

// ---------- ajustes (la clave se guarda cifrada con una llave derivada de JWT_SECRET) ----------

const llave = () => createHash('sha256').update(`ia:${config.jwtSecret}`).digest();

function cifrar(texto) {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), datos].map((b) => b.toString('base64')).join('.');
}

function descifrar(valor) {
  try {
    const [iv, etiqueta, datos] = valor.split('.').map((b) => Buffer.from(b, 'base64'));
    const descifrador = createDecipheriv('aes-256-gcm', llave(), iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString('utf8');
  } catch {
    // La llave cambió (otro JWT_SECRET) o el dato está dañado: hay que volver a escribir la clave.
    return '';
  }
}

async function leerAjustes() {
  const guardado = (await Ajuste.findById('ia'))?.valor ?? {};
  const clavePanel = guardado.clave ? descifrar(guardado.clave) : '';
  return {
    activa: guardado.activa === true,
    responderTodo: guardado.responderTodo === true,
    modelo: Object.hasOwn(MODELOS, guardado.modelo) ? guardado.modelo : MODELO_POR_DEFECTO,
    // La variable de entorno manda sobre lo guardado en el panel.
    clave: config.claveIa || clavePanel,
    origenClave: config.claveIa ? 'entorno' : clavePanel ? 'panel' : null,
  };
}

// Lo que ve el administrador: nunca la clave, solo si existe y sus últimos caracteres.
export async function estadoIa() {
  const a = await leerAjustes();
  return {
    activa: a.activa,
    responderTodo: a.responderTodo,
    modelo: a.modelo,
    modelos: MODELOS,
    tieneClave: Boolean(a.clave),
    origenClave: a.origenClave,
    finalClave: a.clave ? a.clave.slice(-4) : '',
  };
}

export async function guardarIa({ clave, modelo, activa, responderTodo }) {
  const actual = (await Ajuste.findById('ia'))?.valor ?? {};
  const nuevo = { ...actual };
  if (typeof clave === 'string' && clave.trim()) nuevo.clave = cifrar(clave.trim());
  if (clave === null) delete nuevo.clave;
  if (Object.hasOwn(MODELOS, modelo)) nuevo.modelo = modelo;
  if (typeof activa === 'boolean') nuevo.activa = activa;
  if (typeof responderTodo === 'boolean') nuevo.responderTodo = responderTodo;
  await Ajuste.findByIdAndUpdate('ia', { valor: nuevo }, { upsert: true });
  return estadoIa();
}

// La IA está disponible para el bot solo si está activada y hay clave.
export async function iaDisponible() {
  const a = await leerAjustes();
  return { disponible: a.activa && Boolean(a.clave), responderTodo: a.responderTodo };
}

// ---------- conversación ----------

const INSTRUCCIONES = `Eres el asistente de «N.F.T.A Gastos», una app de finanzas personales. Respondes por WhatsApp al dueño de los datos.

Reglas:
- Responde solo con la información del bloque <datos>, que contiene las finanzas reales del usuario. Si algo no está en los datos, dilo con claridad en lugar de suponerlo.
- Haz tú las cuentas (sumas por categoría, comparaciones, cuánto falta por pagar) y da las cifras con la moneda del libro.
- Escribe en español, breve y directo: es un chat de WhatsApp. Usa *negrita* de WhatsApp para las cifras importantes y listas con «•» cuando enumeres. No uses tablas ni encabezados con #.
- No puedes crear, editar ni marcar movimientos; si te lo piden, indica que se hace desde la app.
- Si la pregunta no tiene que ver con las finanzas del usuario, dilo amablemente y recuerda que puede escribir «menu».`;

// Últimos turnos por usuario (se pierden al reiniciar; solo dan continuidad a preguntas seguidas).
const historiales = new Map();
const usoDiario = new Map();

function dentroDelLimite(usuarioId, hoy) {
  const uso = usoDiario.get(usuarioId);
  if (!uso || uso.dia !== hoy) {
    usoDiario.set(usuarioId, { dia: hoy, veces: 1 });
    return true;
  }
  uso.veces += 1;
  return uso.veces <= MAX_PREGUNTAS_DIA;
}

async function pedir(ajustes, parametros) {
  const cliente = new Anthropic({ apiKey: ajustes.clave, maxRetries: 1, timeout: 60_000 });
  const base = { model: ajustes.modelo, max_tokens: 16000, output_config: { effort: 'low' }, ...parametros };
  // Con respaldo, si el modelo declina por sus filtros de seguridad, la API reintenta sola con otro modelo.
  return CON_RESPALDO.includes(ajustes.modelo)
    ? cliente.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : cliente.messages.create(base);
}

const textoDe = (respuesta) => respuesta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// Convierte los errores de la API en un mensaje entendible para el administrador.
export function explicarError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'La clave de la API no es válida.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'La clave no tiene permiso para usar ese modelo.';
  if (err instanceof Anthropic.NotFoundError) return 'El modelo elegido no está disponible para esta clave.';
  if (err instanceof Anthropic.RateLimitError) return 'Se alcanzó el límite de uso de la API. Prueba más tarde.';
  if (err instanceof Anthropic.BadRequestError) return `La API rechazó la petición: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'No se pudo conectar con la API de Claude.';
  if (err instanceof Anthropic.APIError) return `Error de la API (${err.status}).`;
  return 'Error inesperado al consultar la IA.';
}

/**
 * Responde una pregunta libre con los datos financieros del usuario.
 * «contexto» es el objeto de contextoParaIa(); devuelve el texto para enviar por WhatsApp.
 */
export async function preguntar(usuario, contexto, pregunta) {
  const ajustes = await leerAjustes();
  if (!ajustes.activa || !ajustes.clave) return null;
  if (!dentroDelLimite(usuario.id, contexto.hoy)) return `Has llegado al límite de ${MAX_PREGUNTAS_DIA} preguntas a la IA por hoy. Los comandos (escribe *menu*) siguen funcionando.`;

  const historial = historiales.get(usuario.id) ?? [];
  // Los datos van en el mensaje del usuario, después del historial, para que siempre sean los actuales.
  const mensajes = [
    ...historial,
    { role: 'user', content: `<datos>\n${JSON.stringify(contexto)}\n</datos>\n\nPregunta de ${usuario.nombre}: ${pregunta}` },
  ];

  let respuesta;
  try {
    respuesta = await pedir(ajustes, { system: INSTRUCCIONES, messages: mensajes });
  } catch (err) {
    console.error('IA:', explicarError(err), err.message);
    return 'Ahora mismo no puedo consultar la IA. Escribe *menu* para usar los comandos.';
  }
  if (respuesta.stop_reason === 'refusal') return 'No puedo ayudarte con esa pregunta. Escribe *menu* para ver lo que sí puedo hacer.';

  const texto = textoDe(respuesta);
  if (!texto) return 'No he podido preparar una respuesta. Prueba a preguntarlo de otra forma.';
  // En el historial se guarda la pregunta sin los datos, para no acumularlos en cada turno.
  historiales.set(usuario.id, [...historial, { role: 'user', content: pregunta }, { role: 'assistant', content: texto }].slice(-TURNOS_RECORDADOS * 2));
  return texto;
}

// Prueba de la configuración desde el panel: una pregunta mínima para comprobar clave y modelo.
export async function probarIa() {
  const ajustes = await leerAjustes();
  if (!ajustes.clave) return { ok: false, mensaje: 'Falta la clave de la API.' };
  try {
    const respuesta = await pedir(ajustes, { messages: [{ role: 'user', content: 'Responde solo con la palabra: funciona' }] });
    return { ok: true, mensaje: `Conexión correcta con ${MODELOS[ajustes.modelo]}. Respuesta: «${textoDe(respuesta).slice(0, 80)}»` };
  } catch (err) {
    return { ok: false, mensaje: explicarError(err) };
  }
}
