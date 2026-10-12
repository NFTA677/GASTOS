import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
} from 'baileys';
import QRCode from 'qrcode';
import { SesionWa, Usuario } from './models.js';
import { responder, estadoDeCuenta, contextoParaIa, librosDe, textoMenu } from './bot.js';
import { iaDisponible, preguntar } from './ia.js';

// Estado visible para el panel del administrador.
export const wa = { estado: 'desconectado', qr: null, numero: null, aviso: '' };

let socket = null;
let reintento = null;
// Mensajes enviados por el bot: al usar la cuenta del administrador, sus propias respuestas
// vuelven como mensajes «míos» y hay que reconocerlas para no contestarse a sí mismo.
const enviados = new Set();
const ultimoMensaje = new Map();

const silencio = { level: 'silent', child: () => silencio, trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const numeroDe = (jid) => jidDecode(jid)?.user?.replace(/\D/g, '') ?? '';

// ---------- sesión guardada en MongoDB ----------

async function sesionEnMongo() {
  const leer = async (id) => {
    const doc = await SesionWa.findById(id).lean();
    return doc ? JSON.parse(doc.datos, BufferJSON.reviver) : null;
  };
  const escribir = (id, valor) => SesionWa.findByIdAndUpdate(id, { datos: JSON.stringify(valor, BufferJSON.replacer) }, { upsert: true });

  const creds = (await leer('creds')) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const docs = await SesionWa.find({ _id: { $in: ids.map((id) => `${tipo}-${id}`) } }).lean();
          const porId = new Map(docs.map((d) => [d._id, JSON.parse(d.datos, BufferJSON.reviver)]));
          const resultado = {};
          for (const id of ids) {
            let valor = porId.get(`${tipo}-${id}`);
            if (valor && tipo === 'app-state-sync-key') valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            if (valor) resultado[id] = valor;
          }
          return resultado;
        },
        set: async (datos) => {
          const operaciones = [];
          for (const [tipo, valores] of Object.entries(datos)) {
            for (const [id, valor] of Object.entries(valores)) {
              const _id = `${tipo}-${id}`;
              operaciones.push(
                valor
                  ? { updateOne: { filter: { _id }, update: { datos: JSON.stringify(valor, BufferJSON.replacer) }, upsert: true } }
                  : { deleteOne: { filter: { _id } } },
              );
            }
          }
          if (operaciones.length) await SesionWa.bulkWrite(operaciones, { ordered: false });
        },
      },
    },
    guardarCredenciales: () => escribir('creds', creds),
  };
}

const borrarSesion = () => SesionWa.deleteMany({});

// ---------- conexión ----------

function cerrarSocket() {
  clearTimeout(reintento);
  socket?.ev.removeAllListeners();
  try {
    socket?.end(undefined);
  } catch {
    // Ya estaba cerrado.
  }
  socket = null;
}

export async function conectarWhatsapp() {
  if (socket) return;
  wa.estado = 'conectando';
  wa.aviso = '';
  const { state, guardarCredenciales } = await sesionEnMongo();

  socket = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silencio) },
    logger: silencio,
    browser: Browsers.ubuntu('Chrome'),
    // El teléfono sigue recibiendo notificaciones y no se descarga el historial de chats.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });
  const actual = socket;

  actual.ev.on('creds.update', guardarCredenciales);

  actual.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (actual !== socket) return;
    if (qr) {
      wa.estado = 'esperando_qr';
      wa.qr = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
    }
    if (connection === 'open') {
      wa.estado = 'conectado';
      wa.qr = null;
      wa.aviso = '';
      wa.numero = numeroDe(actual.user?.id);
      console.log(`WhatsApp conectado como ${wa.numero}`);
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const teniaSesion = Boolean(state.creds.registered || state.creds.me);
      cerrarSocket();
      wa.qr = null;
      wa.numero = null;

      if (codigo === DisconnectReason.loggedOut) {
        await borrarSesion();
        wa.estado = 'desconectado';
        wa.aviso = 'La sesión se cerró desde el teléfono. Vuelve a conectar y escanea el código.';
      } else if (codigo === DisconnectReason.connectionReplaced) {
        // Otra copia del servidor abrió la misma sesión (pasa durante un despliegue): no se compite con ella.
        wa.estado = 'desconectado';
        wa.aviso = 'La sesión se abrió desde otra instancia del servidor. Pulsa «Conectar» si el bot no responde.';
      } else if (codigo === DisconnectReason.restartRequired || teniaSesion) {
        // Tras escanear el QR WhatsApp pide reiniciar la conexión; con sesión guardada se reintenta siempre.
        wa.estado = 'conectando';
        reintento = setTimeout(() => conectarWhatsapp().catch((err) => console.error('WhatsApp:', err.message)), codigo === DisconnectReason.restartRequired ? 500 : 5000);
      } else {
        wa.estado = 'desconectado';
        wa.aviso = 'El código QR caducó sin escanearse. Pulsa «Conectar» para generar otro.';
      }
    }
  });

  actual.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const mensaje of messages) atender(actual, mensaje).catch((err) => console.error('WhatsApp (mensaje):', err.message));
  });
}

// Cierra la sesión en WhatsApp (el dispositivo desaparece del teléfono) y borra lo guardado.
export async function desconectarWhatsapp() {
  try {
    await socket?.logout();
  } catch {
    // Sin conexión: basta con borrar la sesión local.
  }
  cerrarSocket();
  await borrarSesion();
  Object.assign(wa, { estado: 'desconectado', qr: null, numero: null, aviso: '' });
}

// Al arrancar el servidor: si ya se escaneó el QR en otra ocasión, se reconecta solo.
export async function reanudarWhatsapp() {
  if (await SesionWa.exists({ _id: 'creds' })) await conectarWhatsapp();
}

export function pararWhatsapp() {
  cerrarSocket();
}

// ---------- envío ----------

async function enviar(jid, contenido) {
  const enviado = await socket.sendMessage(jid, contenido);
  if (enviado?.key?.id) {
    enviados.add(enviado.key.id);
    // No hace falta recordarlos mucho tiempo: el eco llega en segundos.
    setTimeout(() => enviados.delete(enviado.key.id), 5 * 60 * 1000);
  }
}

async function enviarRespuesta(jid, respuesta) {
  if (respuesta.pdf) {
    await enviar(jid, { document: respuesta.pdf.buffer, mimetype: 'application/pdf', fileName: respuesta.pdf.nombre, caption: respuesta.texto });
  } else {
    await enviar(jid, { text: respuesta.texto });
  }
}

// Envía el estado de cuenta a un usuario por iniciativa del administrador.
export async function enviarEstadoDeCuenta(usuario) {
  if (wa.estado !== 'conectado') throw new Error('WhatsApp no está conectado');
  if (!usuario.whatsapp) throw new Error(`${usuario.nombre} no tiene número de WhatsApp`);
  const texto = await estadoDeCuenta(usuario);
  if (!texto) throw new Error(`${usuario.nombre} no tiene ningún libro`);
  const [destino] = await socket.onWhatsApp(usuario.whatsapp);
  if (!destino?.exists) throw new Error(`El número de ${usuario.nombre} no tiene WhatsApp`);
  await enviar(destino.jid, { text: texto });
}

// ---------- mensajes entrantes ----------

// Número de teléfono de quien escribe. WhatsApp identifica a veces los chats con un «LID»
// en lugar del número; en ese caso el número llega en remoteJidAlt o hay que resolverlo.
async function numeroDelChat(sock, clave) {
  const jid = clave.remoteJid;
  if (!isLidUser(jid)) return numeroDe(jid);
  if (clave.remoteJidAlt && !isLidUser(clave.remoteJidAlt)) return numeroDe(clave.remoteJidAlt);
  const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
  return pn ? numeroDe(pn) : '';
}

function esMiPropioChat(sock, jid) {
  const chat = jidNormalizedUser(jid);
  return chat === jidNormalizedUser(sock.user?.id) || (sock.user?.lid && chat === jidNormalizedUser(sock.user.lid));
}

async function atender(sock, mensaje) {
  const { key } = mensaje;
  const jid = key.remoteJid;
  if (!jid || !mensaje.message || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return;
  if (enviados.has(key.id)) return;

  const texto = (mensaje.message.conversation ?? mensaje.message.extendedTextMessage?.text ?? '').trim();
  if (!texto || texto.length > 1000) return;
  // Al reconectar pueden llegar mensajes atrasados: no se contestan los de hace más de dos minutos.
  if (Date.now() / 1000 - Number(mensaje.messageTimestamp ?? 0) > 120) return;

  // Lo que el administrador escribe a otras personas no es para el bot; solo su chat consigo mismo.
  let numero;
  if (key.fromMe) {
    if (!esMiPropioChat(sock, jid)) return;
    numero = numeroDe(sock.user.id);
  } else {
    numero = await numeroDelChat(sock, key);
  }
  if (!numero) return;

  // Solo se responde a números registrados en la app: el resto de contactos no nota nada.
  const usuario = await Usuario.findOne({ whatsapp: numero });
  if (!usuario) return;

  // Freno sencillo contra ráfagas: un mensaje por segundo y usuario.
  const ahora = Date.now();
  if (ahora - (ultimoMensaje.get(numero) ?? 0) < 1000) return;
  ultimoMensaje.set(numero, ahora);

  const ia = await iaDisponible();
  const comando = await responder(usuario, texto, { conIa: ia.disponible });
  if (comando) return enviarRespuesta(jid, comando);

  // No es un comando. A la IA se le habla empezando por «ia» o «bot», salvo que esté puesta a responder todo.
  const conPrefijo = /^(ia|bot)\b[\s,:]*/i.exec(texto);
  if (!conPrefijo && !ia.responderTodo) return;
  const pregunta = conPrefijo ? texto.slice(conPrefijo[0].length).trim() : texto;

  if (ia.disponible && pregunta) {
    const contexto = await contextoParaIa(usuario);
    const respuesta = contexto && (await preguntar(usuario, contexto, pregunta));
    if (respuesta) return enviar(jid, { text: respuesta });
  }
  // Se dirigió al bot pero no hay IA (o no escribió nada tras «ia»): se le muestra el menú.
  if (conPrefijo) {
    const [libro] = await librosDe(usuario);
    if (libro) await enviar(jid, { text: textoMenu(usuario, libro, ia.disponible) });
  }
}
