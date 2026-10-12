// Soles y dólares primero; después, todas las monedas que conoce el navegador.
const MONEDAS_FRECUENTES = ['PEN', 'USD', 'EUR'];
const MONEDAS = [
  ...MONEDAS_FRECUENTES,
  ...(Intl.supportedValuesOf?.('currency') ?? ['MXN', 'COP', 'ARS', 'CLP', 'BOB', 'UYU', 'PYG', 'VES', 'DOP', 'CRC', 'GTQ', 'BRL', 'GBP'])
    .filter((m) => !MONEDAS_FRECUENTES.includes(m)),
];
const nombresMoneda = new Intl.DisplayNames('es', { type: 'currency' });
const opcionesMoneda = () => MONEDAS.map((m) => h('option', { value: m }, `${m} · ${nombresMoneda.of(m)}`));

const CATEGORIAS = {
  gasto: ['Vivienda', 'Comida', 'Transporte', 'Servicios', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Deudas', 'Suscripciones', 'Mascotas', 'Otros'],
  ingreso: ['Salario', 'Ventas', 'Freelance', 'Intereses', 'Regalos', 'Otros'],
};
const ROLES = { propietario: 'Propietario', editor: 'Puede editar', lector: 'Solo ver' };
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const estado = {
  usuario: null,
  libros: [],
  libroId: null,
  vista: 'mes',
  mes: hoy().slice(0, 7),
  dia: hoy(),
  anio: Number(hoy().slice(0, 4)),
  // Sección visible dentro de cada vista (los botones que evitan desplazarse).
  seccion: { mes: 'calendario', anio: 'grafica', admin: 'almacenamiento' },
};

// ---------- utilidades ----------

const $ = (selector, raiz = document) => raiz.querySelector(selector);

// Crea elementos sin innerHTML, así el texto de los usuarios nunca se interpreta como HTML.
function h(etiqueta, props, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor == null || valor === false) continue;
    if (clave === 'class') el.className = valor;
    else if (clave.startsWith('on')) el.addEventListener(clave.slice(2), valor);
    else if (clave in el) el[clave] = valor;
    else el.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) if (hijo != null && hijo !== false) el.append(hijo);
  return el;
}

async function api(ruta, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${ruta}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && estado.usuario) mostrarAcceso();
    const error = new Error(datos?.error ?? 'No se pudo completar la operación');
    error.estado = res.status;
    throw error;
  }
  return datos;
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function moverMes(mes, n) {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const fechaTexto = (fecha, opciones) =>
  new Date(`${fecha}T00:00:00Z`).toLocaleDateString('es', { ...opciones, timeZone: 'UTC' });
const nombreMes = (mes, opciones = { month: 'long', year: 'numeric' }) => fechaTexto(`${mes}-01`, opciones);
const fechaCorta = (fecha) => fechaTexto(fecha, { day: 'numeric', month: 'short' });

const libroActual = () => estado.libros.find((l) => l.id === estado.libroId);
const puedeEditar = () => Boolean(libroActual()) && libroActual().rol !== 'lector';

function dinero(monto) {
  const moneda = libroActual()?.moneda ?? 'PEN';
  try {
    // Formato peruano con símbolo corto: «S/ 2,720.50», «$ 2,720.50», «€ 2,720.50».
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: moneda, currencyDisplay: 'narrowSymbol' }).format(monto);
  } catch {
    return `${monto.toFixed(2)} ${moneda}`;
  }
}

const entero = (n) => new Intl.NumberFormat('es-PE').format(n);

let temporizadorAviso;
function avisar(mensaje) {
  const el = $('#aviso');
  el.textContent = mensaje;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), 3500);
}

// Ejecuta una acción y muestra el error como aviso si falla.
async function intentar(accion) {
  try {
    await accion();
  } catch (err) {
    avisar(err.message);
  }
}

function recordarLibro(id) {
  estado.libroId = id;
  try {
    localStorage.setItem('libro', id);
  } catch {
    // Almacenamiento bloqueado: simplemente no se recuerda la selección.
  }
}

// Cambia de mes y deja elegido el día de hoy si cae en él.
function irAMes(mes) {
  estado.mes = mes;
  estado.dia = hoy().startsWith(mes) ? hoy() : null;
  estado.vista = 'mes';
  render();
}

// ---------- acceso ----------

let modoRegistro = false;

function mostrarAcceso() {
  estado.usuario = null;
  for (const dialogo of document.querySelectorAll('dialog[open]')) dialogo.close();
  $('#app').hidden = true;
  $('#auth').hidden = false;
}

function pintarModoAcceso() {
  $('#campo-nombre').hidden = !modoRegistro;
  $('#campo-nombre input').required = modoRegistro;
  $('#auth-enviar').textContent = modoRegistro ? 'Crear cuenta' : 'Entrar';
  $('#auth-pregunta').textContent = modoRegistro ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  $('#auth-cambiar').textContent = modoRegistro ? 'Entrar' : 'Crear una';
  $('#form-auth [name=password]').autocomplete = modoRegistro ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

$('#auth-cambiar').addEventListener('click', () => {
  modoRegistro = !modoRegistro;
  pintarModoAcceso();
});

$('#form-auth').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const body = { email: form.email.value, password: form.password.value };
  if (modoRegistro) body.nombre = form.nombre.value;
  try {
    const { usuario } = await api(modoRegistro ? '/auth/registro' : '/auth/login', { method: 'POST', body });
    form.reset();
    await entrar(usuario);
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  mostrarAcceso();
});

async function entrar(usuario) {
  estado.usuario = usuario;
  $('#usuario').textContent = `${usuario.nombre} · ${usuario.email}`;
  $('#pestana-admin').hidden = !usuario.esAdmin;
  if (!usuario.esAdmin && estado.vista === 'admin') estado.vista = 'mes';
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await cargarLibros();
  render();
}

// ---------- menú lateral ----------

$('#abrir-menu').addEventListener('click', () => $('#menu').showModal());

// Tocar fuera del menú (sobre el fondo oscurecido) lo cierra.
$('#menu').addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget) ev.currentTarget.close();
});

$('#pestanas').addEventListener('click', (ev) => {
  const vista = ev.target.dataset?.vista;
  if (!vista) return;
  estado.vista = vista;
  $('#menu').close();
  render();
});

for (const boton of document.querySelectorAll('[data-cerrar]')) {
  boton.addEventListener('click', () => boton.closest('dialog').close());
}

// ---------- libros ----------

async function cargarLibros() {
  estado.libros = (await api('/libros')).libros;
  let guardado = null;
  try {
    guardado = localStorage.getItem('libro');
  } catch {
    // Sin almacenamiento: se usa el primer libro.
  }
  const preferido = [estado.libroId, guardado].find((id) => estado.libros.some((l) => l.id === id));
  estado.libroId = preferido ?? estado.libros[0]?.id ?? null;

  $('#libro').replaceChildren(
    ...estado.libros.map((l) =>
      h('option', { value: l.id, selected: l.id === estado.libroId },
        l.rol === 'propietario' ? l.nombre : `${l.nombre} (de ${l.propietario})`),
    ),
  );
  pintarMoneda();
}

// El selector de moneda refleja el libro elegido; solo su propietario puede cambiarla.
function pintarMoneda() {
  const libro = libroActual();
  const selector = $('#moneda');
  if (!selector.options.length) selector.replaceChildren(...opcionesMoneda());
  selector.value = libro?.moneda ?? 'PEN';
  selector.disabled = libro?.rol !== 'propietario';
}

$('#libro').addEventListener('change', (ev) => {
  recordarLibro(ev.target.value);
  pintarMoneda();
  render();
});

$('#moneda').addEventListener('change', (ev) =>
  intentar(async () => {
    const libro = libroActual();
    try {
      await api(`/libros/${libro.id}`, { method: 'PATCH', body: { moneda: ev.target.value } });
      libro.moneda = ev.target.value;
      avisar(`Moneda del libro: ${nombresMoneda.of(libro.moneda)}`);
    } finally {
      pintarMoneda();
    }
    render();
  }),
);

let libroEnEdicion = null;

function abrirLibro(libro = null) {
  libroEnEdicion = libro;
  const form = $('#form-libro');
  $('#libro-titulo').textContent = libro ? 'Editar libro' : 'Nuevo libro';
  $('#libro-error').textContent = '';
  form.nombre.value = libro?.nombre ?? '';
  form.moneda.replaceChildren(...opcionesMoneda());
  form.moneda.value = libro?.moneda ?? libroActual()?.moneda ?? 'PEN';
  $('#menu').close();
  $('#dlg-libro').showModal();
}

$('#nuevo-libro').addEventListener('click', () => abrirLibro());

$('#form-libro').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const body = { nombre: form.nombre.value, moneda: form.moneda.value };
  try {
    if (libroEnEdicion) {
      await api(`/libros/${libroEnEdicion.id}`, { method: 'PATCH', body });
    } else {
      const { libro } = await api('/libros', { method: 'POST', body });
      recordarLibro(libro.id);
    }
    $('#dlg-libro').close();
    await cargarLibros();
    render();
  } catch (err) {
    $('#libro-error').textContent = err.message;
  }
});

// ---------- movimientos ----------

let movEnEdicion = null;

function pintarTipoMovimiento() {
  const form = $('#form-mov');
  const tipo = form.tipo.value;
  $('#mov-pagado-texto').textContent = tipo === 'gasto' ? 'Ya está pagado' : 'Ya está recibido';
  $('#categorias').replaceChildren(...CATEGORIAS[tipo].map((c) => h('option', { value: c })));
}

// Sin movimiento abre el alta; «fecha» propone un día concreto (el elegido en el calendario).
function abrirMovimiento(mov = null, fecha = null) {
  movEnEdicion = mov;
  const form = $('#form-mov');
  form.reset();
  $('#mov-titulo').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#mov-error').textContent = '';
  $('#campo-repetir').hidden = Boolean(mov);
  $('#mov-eliminar').hidden = !mov;
  if (mov) {
    form.tipo.value = mov.tipo;
    form.descripcion.value = mov.descripcion;
    form.monto.value = mov.monto;
    form.fecha.value = mov.fecha;
    form.categoria.value = mov.categoria;
    form.pagado.checked = mov.pagado;
  } else {
    // Por defecto: el día pedido, hoy si estamos en el mes actual, o el primer día del mes visible.
    form.fecha.value = fecha ?? (hoy().startsWith(estado.mes) ? hoy() : `${estado.mes}-01`);
    form.pagado.checked = form.fecha.value <= hoy();
  }
  pintarTipoMovimiento();
  $('#dlg-mov').showModal();
}

$('#nuevo-rapido').addEventListener('click', () => abrirMovimiento(null, estado.vista === 'mes' ? estado.dia : null));

$('#mov-eliminar').addEventListener('click', () => {
  $('#dlg-mov').close();
  eliminarMovimiento(movEnEdicion);
});

$('#form-mov').addEventListener('change', (ev) => {
  if (ev.target.name === 'tipo') pintarTipoMovimiento();
});

$('#form-mov').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const body = {
    tipo: form.tipo.value,
    descripcion: form.descripcion.value,
    monto: Number(form.monto.value),
    fecha: form.fecha.value,
    categoria: form.categoria.value,
    pagado: form.pagado.checked,
  };
  const base = `/libros/${estado.libroId}/movimientos`;
  try {
    if (movEnEdicion) {
      await api(`${base}/${movEnEdicion.id}`, { method: 'PATCH', body });
    } else {
      body.repetirMeses = Number(form.repetirMeses.value);
      const { creados } = await api(base, { method: 'POST', body });
      if (creados > 1) avisar(`Se crearon ${creados} movimientos mensuales`);
    }
    $('#dlg-mov').close();
    render();
  } catch (err) {
    $('#mov-error').textContent = err.message;
  }
});

const marcarPagado = (mov, pagado) =>
  intentar(async () => {
    await api(`/libros/${estado.libroId}/movimientos/${mov.id}`, { method: 'PATCH', body: { pagado } });
    render();
  });

const eliminarMovimiento = (mov) =>
  intentar(async () => {
    if (!confirm(`¿Eliminar «${mov.descripcion}»?`)) return;
    const siguientes = mov.enSerie && confirm('Este movimiento se repite cada mes.\n¿Eliminar también las repeticiones de los meses siguientes?');
    await api(`/libros/${estado.libroId}/movimientos/${mov.id}${siguientes ? '?siguientes=1' : ''}`, { method: 'DELETE' });
    render();
  });

function chipEstado(mov) {
  if (mov.pagado) return h('span', { class: 'chip ok' }, mov.tipo === 'gasto' ? 'Pagado' : 'Recibido');
  if (mov.fecha < hoy()) return h('span', { class: 'chip vencido' }, mov.tipo === 'gasto' ? 'Vencido' : 'Atrasado');
  return h('span', { class: 'chip' }, mov.tipo === 'gasto' ? 'Pendiente' : 'Por recibir');
}

// Un movimiento como fila de lista; se usa en el calendario, en pendientes y en el listado del mes.
// Tocar el movimiento lo abre para editarlo o eliminarlo; al lado queda solo el botón de pagar.
function filaMovimiento(m, editar) {
  const contenido = [
    h('span', { class: 'cuerpo' },
      h('strong', null, m.descripcion, m.enSerie && h('span', { class: 'tenue', title: 'Se repite cada mes' }, ' ↻')),
      h('small', null, `${fechaCorta(m.fecha)} · ${m.categoria} `),
      chipEstado(m),
    ),
    h('span', { class: `monto ${m.tipo}` }, `${m.tipo === 'gasto' ? '−' : '+'}${dinero(m.monto)}`),
  ];
  if (!editar) return h('li', { class: 'mov' }, h('div', { class: 'mov-abrir' }, contenido));

  return h('li', { class: 'mov' },
    h('button', { type: 'button', class: 'mov-abrir', title: 'Editar o eliminar', onclick: () => abrirMovimiento(m) }, contenido),
    m.pagado
      ? h('button', { type: 'button', class: 'mini', onclick: () => marcarPagado(m, false), 'aria-label': `Deshacer el pago de ${m.descripcion}` }, 'Deshacer')
      : h('button', { type: 'button', class: 'mini primario', onclick: () => marcarPagado(m, true) }, m.tipo === 'gasto' ? 'Pagar' : 'Cobrar'),
  );
}

const listaMovimientos = (movimientos, editar, textoVacio) =>
  movimientos.length === 0
    ? h('p', { class: 'vacio' }, textoVacio)
    : h('ul', { class: 'lista' }, movimientos.map((m) => filaMovimiento(m, editar)));

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
  t.balance = t.ingresos - t.gastos;
  return t;
}

const tarjeta = (etiqueta, valor, nota, clase = '') =>
  h('div', { class: `tarjeta ${clase}` },
    h('div', { class: 'etiqueta' }, etiqueta),
    h('div', { class: 'valor' }, valor),
    nota && h('div', { class: 'nota' }, nota),
  );

// Botones que cambian la sección visible de una vista sin volver a pedir los datos.
// opciones: [valor, etiqueta, contador opcional, contador en rojo]
function segmentos(vista, opciones) {
  return h('div', { class: 'segmentos', role: 'tablist' },
    opciones.map(([valor, etiqueta, contador, rojo]) =>
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(estado.seccion[vista] === valor),
        onclick: () => {
          estado.seccion[vista] = valor;
          render(true);
        },
      }, etiqueta, contador > 0 && h('span', { class: rojo ? 'cuenta' : 'cuenta neutra' }, String(contador))),
    ),
  );
}

// ---------- vista: mes ----------

async function cargarMes() {
  const base = `/libros/${estado.libroId}`;
  const [actual, proximo, pendientes] = await Promise.all([
    api(`${base}/movimientos?mes=${estado.mes}`),
    api(`${base}/movimientos?mes=${moverMes(estado.mes, 1)}`),
    api(`${base}/pendientes?hasta=${sumarDias(hoy(), 30)}`),
  ]);
  return { actual: actual.movimientos, proximo: proximo.movimientos, pendientes: pendientes.movimientos };
}

// Rejilla del mes: punto rojo si ese día hay un pago sin hacer, punto gris si hay otros movimientos.
function calendario(movimientos) {
  const porDia = new Map();
  for (const m of movimientos) {
    const dia = porDia.get(m.fecha) ?? { pendiente: false, otros: false };
    if (m.tipo === 'gasto' && !m.pagado) dia.pendiente = true;
    else dia.otros = true;
    porDia.set(m.fecha, dia);
  }

  const [anio, mes] = estado.mes.split('-').map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  // La semana empieza en lunes: getUTCDay() da 0 para el domingo.
  const huecos = (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;

  const celdas = DIAS_SEMANA.map((d) => h('div', { class: 'dia-semana', 'aria-hidden': 'true' }, d));
  for (let i = 0; i < huecos; i++) celdas.push(h('span'));
  for (let d = 1; d <= diasDelMes; d++) {
    const fecha = `${estado.mes}-${String(d).padStart(2, '0')}`;
    const info = porDia.get(fecha);
    const descripcion = [
      fechaTexto(fecha, { weekday: 'long', day: 'numeric', month: 'long' }),
      info?.pendiente && 'con pagos pendientes',
      info?.otros && 'con movimientos',
    ].filter(Boolean).join(', ');
    celdas.push(
      h('button', {
        type: 'button',
        class: ['dia', fecha === hoy() && 'hoy', fecha === estado.dia && 'elegido'].filter(Boolean).join(' '),
        'aria-label': descripcion,
        'aria-pressed': String(fecha === estado.dia),
        onclick: () => {
          estado.dia = fecha;
          render(true);
        },
      },
        String(d),
        h('span', { class: 'puntos' },
          info?.pendiente && h('span', { class: 'punto rojo' }),
          info?.otros && h('span', { class: 'punto' }),
        ),
      ),
    );
  }

  return [
    h('div', { class: 'calendario' }, celdas),
    h('div', { class: 'leyenda' },
      h('span', null, h('span', { class: 'punto rojo' }), 'Pago pendiente'),
      h('span', null, h('span', { class: 'punto' }), 'Pagado o ingreso'),
    ),
  ];
}

function pintarMes({ actual, proximo, pendientes }) {
  const t = totales(actual);
  const tp = totales(proximo);
  const editar = puedeEditar();
  const siguiente = moverMes(estado.mes, 1);
  const mesActual = hoy().slice(0, 7);
  const delDia = estado.dia ? actual.filter((m) => m.fecha === estado.dia) : [];

  const secciones = {
    calendario: () =>
      h('div', { class: 'dos-columnas' },
        h('section', { class: 'panel' }, calendario(actual)),
        h('section', { class: 'panel' },
          estado.dia
            ? [
                h('header', null, h('h3', null, fechaTexto(estado.dia, { weekday: 'long', day: 'numeric', month: 'long' }))),
                listaMovimientos(delDia, editar, 'No hay movimientos este día.'),
                editar && h('div', { class: 'pie-panel' },
                  h('button', { type: 'button', class: 'primario ancho', onclick: () => abrirMovimiento(null, estado.dia) }, '+ Añadir en este día')),
              ]
            : h('p', { class: 'vacio' }, 'Toca un día del calendario para ver sus movimientos.'),
        ),
      ),
    pendientes: () =>
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Pagos y cobros pendientes'), h('span', { class: 'tenue' }, 'vencidos y próximos 30 días')),
        listaMovimientos(pendientes, editar, 'No hay nada pendiente. ¡Todo al día!'),
      ),
    movimientos: () =>
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Movimientos del mes')),
        listaMovimientos(actual, editar, 'No hay movimientos este mes.'),
      ),
  };

  return [
    h('div', { class: 'periodo' },
      h('button', { type: 'button', class: 'cuadrado', onclick: () => irAMes(moverMes(estado.mes, -1)), 'aria-label': 'Mes anterior' }, '‹'),
      h('h2', null, nombreMes(estado.mes)),
      h('button', { type: 'button', class: 'cuadrado', onclick: () => irAMes(siguiente), 'aria-label': 'Mes siguiente' }, '›'),
      estado.mes !== mesActual && h('button', { type: 'button', onclick: () => irAMes(mesActual) }, 'Hoy'),
    ),

    h('div', { class: 'tarjetas' },
      tarjeta('Ingresos', dinero(t.ingresos), t.ingresosPendientes > 0 ? `${dinero(t.ingresosPendientes)} por recibir` : 'Todo recibido'),
      tarjeta('Gastos', dinero(t.gastos), `${dinero(t.gastos - t.gastosPendientes)} ya pagado`),
      tarjeta('Balance', dinero(t.balance), 'Ingresos menos gastos', 'destacada'),
      tarjeta('Falta por pagar', dinero(t.gastosPendientes), 'Gastos sin pagar del mes'),
    ),

    h('button', { type: 'button', class: 'tira', onclick: () => irAMes(siguiente), title: 'Ver el mes siguiente' },
      h('strong', null, `Próximo mes · ${nombreMes(siguiente, { month: 'long' })}`),
      h('span', null, `Ingresos ${dinero(tp.ingresos)}`),
      h('span', null, `Gastos ${dinero(tp.gastos)}`),
      h('span', null, h('b', null, `Balance ${dinero(tp.balance)}`)),
      h('span', { class: 'flecha', 'aria-hidden': 'true' }, '›'),
    ),

    segmentos('mes', [
      ['calendario', 'Calendario'],
      ['pendientes', 'Pendientes', pendientes.length, true],
      ['movimientos', 'Movimientos', actual.length],
    ]),
    secciones[estado.seccion.mes](),
  ];
}

// ---------- vista: año ----------

const cargarAnio = () => api(`/libros/${estado.libroId}/resumen?anio=${estado.anio}`);

function pintarAnio(r) {
  const t = r.totales;
  const maximo = Math.max(1, ...r.meses.flatMap((m) => [m.ingresos, m.gastos]));
  const claveMes = (m) => `${r.anio}-${String(m.mes).padStart(2, '0')}`;
  const irAAnio = (anio) => () => {
    estado.anio = anio;
    render();
  };
  const anioActual = Number(hoy().slice(0, 4));
  const signo = (n) => (n < 0 ? 'gasto' : '');

  const tablaCategorias = (titulo, lista, total) =>
    h('section', { class: 'panel' },
      h('header', null, h('h3', null, titulo)),
      lista.length === 0
        ? h('p', { class: 'vacio' }, 'Sin datos este año.')
        : h('table', null,
            h('tbody', null,
              lista.map((c) =>
                h('tr', null,
                  h('td', null, c.categoria, h('div', { class: 'barra-cat', style: `width:${(c.total / lista[0].total) * 100}%` })),
                  h('td', { class: 'monto' }, dinero(c.total)),
                  h('td', { class: 'monto tenue' }, `${Math.round((c.total / total) * 100)} %`),
                ),
              ),
            ),
          ),
    );

  const secciones = {
    grafica: () =>
      h('section', { class: 'panel' },
        h('header', null,
          h('h3', null, 'Ingresos y gastos por mes'),
          h('span', { class: 'espacio' }),
          h('div', { class: 'leyenda' },
            h('span', null, h('i', { class: 'trama-ingreso' }), 'Ingresos'),
            h('span', null, h('i', { class: 'trama-gasto' }), 'Gastos'),
          ),
        ),
        h('div', { class: 'grafica' },
          r.meses.map((m) =>
            h('button', {
              type: 'button',
              class: 'mes',
              onclick: () => irAMes(claveMes(m)),
              title: `${nombreMes(claveMes(m))}\nIngresos: ${dinero(m.ingresos)}\nGastos: ${dinero(m.gastos)}`,
            },
              h('div', { class: 'barras' },
                h('div', { class: 'columna trama-ingreso', style: `height:${(m.ingresos / maximo) * 100}%` }),
                h('div', { class: 'columna trama-gasto', style: `height:${(m.gastos / maximo) * 100}%` }),
              ),
              h('div', { class: 'nombre' }, nombreMes(claveMes(m), { month: 'short' }).replace('.', '')),
            ),
          ),
        ),
      ),
    meses: () =>
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Detalle por mes'), h('span', { class: 'tenue' }, 'toca un mes para abrirlo')),
        h('div', { class: 'tabla-scroll' },
          h('table', null,
            h('thead', null,
              h('tr', null,
                h('th', null, 'Mes'),
                h('th', { class: 'monto' }, 'Ingresos'),
                h('th', { class: 'monto' }, 'Gastos'),
                h('th', { class: 'monto ocultar-movil' }, 'Por pagar'),
                h('th', { class: 'monto' }, 'Balance'),
              ),
            ),
            h('tbody', null,
              r.meses.map((m) =>
                h('tr', { class: 'clic', onclick: () => irAMes(claveMes(m)) },
                  h('td', { class: 'capital' }, nombreMes(claveMes(m), { month: 'long' })),
                  h('td', { class: 'monto' }, dinero(m.ingresos)),
                  h('td', { class: 'monto' }, dinero(m.gastos)),
                  h('td', { class: 'monto ocultar-movil' }, dinero(m.gastosPendientes)),
                  h('td', { class: `monto ${signo(m.balance)}` }, dinero(m.balance)),
                ),
              ),
            ),
            h('tfoot', null,
              h('tr', null,
                h('td', null, `Total ${r.anio}`),
                h('td', { class: 'monto' }, dinero(t.ingresos)),
                h('td', { class: 'monto' }, dinero(t.gastos)),
                h('td', { class: 'monto ocultar-movil' }, dinero(t.gastosPendientes)),
                h('td', { class: 'monto' }, dinero(t.balance)),
              ),
            ),
          ),
        ),
      ),
    categorias: () =>
      h('div', { class: 'dos-columnas' },
        tablaCategorias('Gastos por categoría', r.categorias.filter((c) => c.tipo === 'gasto'), t.gastos),
        tablaCategorias('Ingresos por categoría', r.categorias.filter((c) => c.tipo === 'ingreso'), t.ingresos),
      ),
  };

  return [
    h('div', { class: 'periodo' },
      h('button', { type: 'button', class: 'cuadrado', onclick: irAAnio(r.anio - 1), 'aria-label': 'Año anterior' }, '‹'),
      h('h2', null, `Año ${r.anio}`),
      h('button', { type: 'button', class: 'cuadrado', onclick: irAAnio(r.anio + 1), 'aria-label': 'Año siguiente' }, '›'),
      r.anio !== anioActual && h('button', { type: 'button', onclick: irAAnio(anioActual) }, 'Este año'),
    ),

    h('div', { class: 'tarjetas' },
      tarjeta('Ingresos del año', dinero(t.ingresos), t.ingresosPendientes > 0 ? `${dinero(t.ingresosPendientes)} por recibir` : 'Todo recibido'),
      tarjeta('Gastos del año', dinero(t.gastos), `${dinero(t.gastosPagados)} ya pagado`),
      tarjeta('Balance del año', dinero(t.balance), 'Ingresos menos gastos', 'destacada'),
      tarjeta('Falta por pagar', dinero(t.gastosPendientes), 'Gastos sin pagar del año'),
    ),

    segmentos('anio', [['grafica', 'Gráfica'], ['meses', 'Por mes'], ['categorias', 'Categorías']]),
    secciones[estado.seccion.anio](),
  ];
}

// ---------- vista: compartir ----------

const cargarCompartir = async () => (await api(`/libros/${estado.libroId}/miembros`)).miembros;

function pintarCompartir(miembros) {
  const libro = libroActual();
  const base = `/libros/${libro.id}`;
  const soyPropietario = libro.rol === 'propietario';

  const cambiarRol = (miembro, rol) =>
    intentar(async () => {
      await api(`${base}/miembros/${miembro.id}`, { method: 'PATCH', body: { rol } });
      avisar(`${miembro.nombre}: ${ROLES[rol].toLowerCase()}`);
    });

  const quitar = (miembro) =>
    intentar(async () => {
      const esYo = miembro.id === estado.usuario.id;
      const pregunta = esYo ? `¿Salir del libro «${libro.nombre}»?` : `¿Quitar el acceso de ${miembro.nombre}?`;
      if (!confirm(pregunta)) return;
      await api(`${base}/miembros/${miembro.id}`, { method: 'DELETE' });
      if (esYo) await cargarLibros();
      render();
    });

  const invitar = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    intentar(async () => {
      const { miembro } = await api(`${base}/miembros`, {
        method: 'POST',
        body: { email: form.email.value, rol: form.rol.value },
      });
      avisar(`${miembro.nombre} ya puede ver este libro`);
      render();
    });
  };

  const eliminarLibro = () =>
    intentar(async () => {
      if (!confirm(`¿Eliminar el libro «${libro.nombre}» y TODOS sus movimientos? No se puede deshacer.`)) return;
      await api(base, { method: 'DELETE' });
      estado.libroId = null;
      await cargarLibros();
      render();
    });

  return [
    h('div', { class: 'periodo' }, h('h2', { class: 'izquierda' }, 'Compartir')),

    h('section', { class: 'panel' },
      h('header', null,
        h('h3', null, libro.nombre),
        h('span', { class: 'tenue' }, `Moneda: ${libro.moneda} · Tu acceso: ${ROLES[libro.rol].toLowerCase()}`),
        h('span', { class: 'espacio' }),
        soyPropietario && h('button', { type: 'button', class: 'mini', onclick: () => abrirLibro(libro) }, 'Editar'),
        soyPropietario && h('button', { type: 'button', class: 'mini peligro', onclick: eliminarLibro }, 'Eliminar libro'),
      ),
      h('div', { class: 'tabla-scroll' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Persona'), h('th', null, 'Acceso'), h('th', null))),
          h('tbody', null,
            miembros.map((m) =>
              h('tr', null,
                h('td', null, m.nombre, m.id === estado.usuario.id && ' (tú)', h('div', { class: 'tenue correo' }, m.email)),
                h('td', null,
                  soyPropietario && m.rol !== 'propietario'
                    ? h('select', { 'aria-label': `Acceso de ${m.nombre}`, onchange: (ev) => cambiarRol(m, ev.target.value) },
                        h('option', { value: 'lector', selected: m.rol === 'lector' }, ROLES.lector),
                        h('option', { value: 'editor', selected: m.rol === 'editor' }, ROLES.editor),
                      )
                    : ROLES[m.rol],
                ),
                h('td', { class: 'acciones-fila' },
                  m.rol !== 'propietario' && (soyPropietario || m.id === estado.usuario.id) &&
                    h('button', { type: 'button', class: 'mini peligro', onclick: () => quitar(m) },
                      m.id === estado.usuario.id ? 'Salir del libro' : 'Quitar'),
                ),
              ),
            ),
          ),
        ),
      ),
    ),

    soyPropietario
      ? h('section', { class: 'panel' },
          h('header', null, h('h3', null, 'Invitar a alguien')),
          h('p', { class: 'tenue' }, 'La otra persona debe tener ya una cuenta. Escribe el correo con el que se registró.'),
          h('form', { class: 'form-linea', onsubmit: invitar },
            h('label', null, 'Correo', h('input', { name: 'email', type: 'email', required: true })),
            h('label', { class: 'corto' }, 'Acceso',
              h('select', { name: 'rol' },
                h('option', { value: 'lector' }, ROLES.lector),
                h('option', { value: 'editor' }, ROLES.editor),
              ),
            ),
            h('button', { class: 'primario' }, 'Compartir'),
          ),
        )
      : h('p', { class: 'tenue' }, 'Solo el propietario puede invitar a más personas o cambiar permisos.'),
  ];
}

// ---------- vista: administrador ----------

function tamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function cargarAdmin() {
  const [almacenamiento, { usuarios }] = await Promise.all([api('/admin/almacenamiento'), api('/admin/usuarios')]);
  return { almacenamiento, usuarios };
}

function pintarAdmin({ almacenamiento: a, usuarios }) {
  const porcentaje = a.porcentaje < 0.1 && a.usado > 0 ? '< 0.1' : a.porcentaje.toFixed(1);

  const crearUsuario = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    intentar(async () => {
      const { usuario } = await api('/admin/usuarios', {
        method: 'POST',
        body: { nombre: form.nombre.value, email: form.email.value, password: form.password.value },
      });
      avisar(`Cuenta creada para ${usuario.nombre}`);
      render();
    });
  };

  const eliminarUsuario = (u) =>
    intentar(async () => {
      const aviso = `¿Eliminar la cuenta de ${u.nombre} (${u.email})?\n\nSe borrarán también sus libros y todos los movimientos que contienen. No se puede deshacer.`;
      if (!confirm(aviso)) return;
      const { eliminado } = await api(`/admin/usuarios/${u.id}`, { method: 'DELETE' });
      avisar(`Cuenta de ${eliminado.nombre} eliminada (${eliminado.movimientos} movimientos borrados)`);
      // Si compartía algún libro contigo, la lista de libros puede haber cambiado.
      await cargarLibros();
      render();
    });

  const secciones = {
    almacenamiento: () =>
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Uso de la base de datos'), h('span', { class: 'tenue' }, `${porcentaje} % usado`)),
        h('div', { class: 'medidor', role: 'img', 'aria-label': `${porcentaje} % del almacenamiento usado` },
          h('div', { style: `width:${Math.max(a.porcentaje, a.usado > 0 ? 0.5 : 0)}%` }),
        ),
        h('p', { class: 'tenue nota-medidor' },
          a.clusterCompleto
            ? 'Incluye todas las bases de datos del clúster, porque el límite del plan es compartido.'
            : 'Solo se pudo medir la base de datos de esta app; si el clúster tiene otras, también ocupan espacio.'),
        a.porcentaje >= 80 && h('p', { class: 'error' }, 'Queda poco espacio. Conviene borrar movimientos antiguos o ampliar el plan de MongoDB.'),
        a.bases.length > 1 && h('div', { class: 'tabla-scroll' },
          h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Base de datos'), h('th', { class: 'monto' }, 'Documentos'), h('th', { class: 'monto' }, 'Tamaño'))),
            h('tbody', null,
              a.bases.map((b) =>
                h('tr', null,
                  h('td', null, b.nombre, b.propia && h('span', { class: 'tenue' }, ' (esta app)')),
                  h('td', { class: 'monto' }, entero(b.documentos)),
                  h('td', { class: 'monto' }, tamano(b.bytes)),
                ),
              ),
            ),
          ),
        ),
      ),
    usuarios: () => [
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Usuarios registrados')),
        h('div', { class: 'tabla-scroll' },
          h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Persona'), h('th', { class: 'ocultar-movil' }, 'Registro'), h('th', { class: 'monto' }, 'Libros'), h('th', null))),
            h('tbody', null,
              usuarios.map((u) =>
                h('tr', null,
                  h('td', null, u.nombre, u.id === estado.usuario.id && ' (tú)', h('div', { class: 'tenue correo' }, u.email)),
                  h('td', { class: 'ocultar-movil' }, u.registro),
                  h('td', { class: 'monto' }, String(u.libros)),
                  h('td', { class: 'acciones-fila' },
                    u.id !== estado.usuario.id &&
                      h('button', { type: 'button', class: 'mini peligro', onclick: () => eliminarUsuario(u) }, 'Eliminar'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      h('section', { class: 'panel' },
        h('header', null, h('h3', null, 'Añadir usuario')),
        h('p', { class: 'tenue' }, 'Crea la cuenta y pásale el correo y la contraseña a la persona. Empezará con un libro «Personal» vacío.'),
        h('form', { class: 'form-linea', onsubmit: crearUsuario },
          h('label', null, 'Nombre', h('input', { name: 'nombre', maxLength: 60, required: true, autocomplete: 'off' })),
          h('label', null, 'Correo', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
          h('label', null, 'Contraseña', h('input', { name: 'password', type: 'password', minLength: 8, maxLength: 72, required: true, autocomplete: 'new-password' })),
          h('button', { class: 'primario' }, 'Crear cuenta'),
        ),
      ),
    ],
  };

  return [
    h('div', { class: 'periodo' }, h('h2', { class: 'izquierda' }, 'Administrador')),

    h('div', { class: 'tarjetas' },
      tarjeta('Espacio libre', tamano(a.libre), `de ${tamano(a.limite)} en total`, 'destacada'),
      tarjeta('Espacio usado', tamano(a.usado), `${porcentaje} % del total`),
      tarjeta('Movimientos que aún caben', `≈ ${entero(a.movimientosQueCaben)}`, 'Estimación'),
      tarjeta('Movimientos guardados', entero(a.totales.movimientos),
        `${entero(a.totales.usuarios)} ${a.totales.usuarios === 1 ? 'usuario' : 'usuarios'} · ${entero(a.totales.libros)} ${a.totales.libros === 1 ? 'libro' : 'libros'}`),
    ),

    segmentos('admin', [['almacenamiento', 'Almacenamiento'], ['usuarios', 'Usuarios', usuarios.length]]),
    secciones[estado.seccion.admin](),
  ];
}

// ---------- render ----------

const VISTAS = {
  mes: { cargar: cargarMes, pintar: pintarMes },
  anio: { cargar: cargarAnio, pintar: pintarAnio },
  compartir: { cargar: cargarCompartir, pintar: pintarCompartir },
  admin: { cargar: cargarAdmin, pintar: pintarAdmin },
};
let turno = 0;
// Últimos datos descargados, para repintar (cambio de sección o de día) sin volver a pedirlos.
let memoria = { vista: null, datos: null };

async function render(reutilizar = false) {
  const miTurno = ++turno;
  const cont = $('#contenido');
  const libro = libroActual();

  for (const boton of $('#pestanas').children) {
    if (boton.dataset.vista === estado.vista) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  }
  $('#titulo-libro').textContent = libro ? `${libro.nombre} · ${libro.moneda}` : '';
  $('#nuevo-rapido').hidden = !puedeEditar() || estado.vista === 'admin';

  if (!libro && estado.vista !== 'admin') {
    cont.replaceChildren(h('p', { class: 'vacio' }, 'No tienes ningún libro. Abre el menú y crea uno con «+ Nuevo libro».'));
    return;
  }
  try {
    const vista = VISTAS[estado.vista];
    if (!(reutilizar && memoria.vista === estado.vista)) {
      const datos = await vista.cargar();
      // Si mientras cargaba se pidió otra vista, se descarta este resultado.
      if (miTurno !== turno) return;
      memoria = { vista: estado.vista, datos };
    }
    cont.replaceChildren(...vista.pintar(memoria.datos).flat().filter(Boolean));
  } catch (err) {
    if (miTurno === turno) cont.replaceChildren(h('p', { class: 'error' }, err.message));
  }
}

// ---------- instalación como app ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Sin service worker la app funciona igual, solo que no se puede instalar.
  });
}

let avisoInstalacion = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  avisoInstalacion = ev;
  $('#instalar').hidden = false;
});
$('#instalar').addEventListener('click', async () => {
  $('#instalar').hidden = true;
  $('#menu').close();
  await avisoInstalacion?.prompt();
  avisoInstalacion = null;
});
window.addEventListener('appinstalled', () => ($('#instalar').hidden = true));

// ---------- arranque ----------

pintarModoAcceso();
try {
  const { usuario } = await api('/auth/yo');
  await entrar(usuario);
} catch (err) {
  mostrarAcceso();
  // Sin sesión (401) es lo normal; un fallo del servidor sí se le cuenta al usuario.
  if (err.estado !== 401) $('#auth-error').textContent = err.message;
}
