const MONEDAS = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BOB', 'UYU', 'PYG', 'VES', 'DOP', 'CRC', 'GTQ', 'HNL', 'NIO', 'BRL'];
const CATEGORIAS = {
  gasto: ['Vivienda', 'Comida', 'Transporte', 'Servicios', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Deudas', 'Suscripciones', 'Mascotas', 'Otros'],
  ingreso: ['Salario', 'Ventas', 'Freelance', 'Intereses', 'Regalos', 'Otros'],
};
const ROLES = { propietario: 'Propietario', editor: 'Puede editar', lector: 'Solo ver' };

const estado = {
  usuario: null,
  libros: [],
  libroId: null,
  vista: 'mes',
  mes: hoy().slice(0, 7),
  anio: Number(hoy().slice(0, 4)),
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

const nombreMes = (mes, opciones = { month: 'long', year: 'numeric' }) =>
  new Date(`${mes}-01T00:00:00Z`).toLocaleDateString('es', { ...opciones, timeZone: 'UTC' });

const fechaCorta = (fecha) =>
  new Date(`${fecha}T00:00:00Z`).toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const libroActual = () => estado.libros.find((l) => l.id === estado.libroId);
const puedeEditar = () => libroActual()?.rol !== 'lector';

function dinero(monto) {
  const moneda = libroActual()?.moneda ?? 'USD';
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency: moneda }).format(monto);
  } catch {
    return `${monto.toFixed(2)} ${moneda}`;
  }
}

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

// ---------- acceso ----------

let modoRegistro = false;

function mostrarAcceso() {
  estado.usuario = null;
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
  $('#usuario').textContent = usuario.nombre;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await cargarLibros();
  render();
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
}

$('#libro').addEventListener('change', (ev) => {
  recordarLibro(ev.target.value);
  render();
});

let libroEnEdicion = null;

function abrirLibro(libro = null) {
  libroEnEdicion = libro;
  const form = $('#form-libro');
  $('#libro-titulo').textContent = libro ? 'Editar libro' : 'Nuevo libro';
  $('#libro-error').textContent = '';
  form.nombre.value = libro?.nombre ?? '';
  form.moneda.replaceChildren(...MONEDAS.map((m) => h('option', { value: m }, m)));
  form.moneda.value = libro?.moneda ?? libroActual()?.moneda ?? 'USD';
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

for (const boton of document.querySelectorAll('[data-cerrar]')) {
  boton.addEventListener('click', () => boton.closest('dialog').close());
}

// ---------- movimientos ----------

let movEnEdicion = null;

function pintarTipoMovimiento() {
  const form = $('#form-mov');
  const tipo = form.tipo.value;
  $('#mov-pagado-texto').textContent = tipo === 'gasto' ? 'Ya está pagado' : 'Ya está recibido';
  $('#categorias').replaceChildren(...CATEGORIAS[tipo].map((c) => h('option', { value: c })));
}

function abrirMovimiento(mov = null) {
  movEnEdicion = mov;
  const form = $('#form-mov');
  form.reset();
  $('#mov-titulo').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#mov-error').textContent = '';
  $('#campo-repetir').hidden = Boolean(mov);
  if (mov) {
    form.tipo.value = mov.tipo;
    form.descripcion.value = mov.descripcion;
    form.monto.value = mov.monto;
    form.fecha.value = mov.fecha;
    form.categoria.value = mov.categoria;
    form.pagado.checked = mov.pagado;
  } else {
    // Dentro del mes actual se propone hoy; en otro mes, su primer día.
    form.fecha.value = hoy().startsWith(estado.mes) ? hoy() : `${estado.mes}-01`;
    form.pagado.checked = form.fecha.value <= hoy();
  }
  pintarTipoMovimiento();
  $('#dlg-mov').showModal();
}

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

const montoConSigno = (mov) =>
  h('span', { class: mov.tipo }, `${mov.tipo === 'gasto' ? '−' : '+'}${dinero(mov.monto)}`);

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

const claseBalance = (n) => (n < 0 ? 'gasto' : n > 0 ? 'ingreso' : '');

// ---------- vista: mes ----------

async function vistaMes() {
  const base = `/libros/${estado.libroId}`;
  const siguiente = moverMes(estado.mes, 1);
  const [actual, proximo, pendientes] = await Promise.all([
    api(`${base}/movimientos?mes=${estado.mes}`),
    api(`${base}/movimientos?mes=${siguiente}`),
    api(`${base}/pendientes?hasta=${sumarDias(hoy(), 30)}`),
  ]);
  const t = totales(actual.movimientos);
  const tp = totales(proximo.movimientos);
  const editar = puedeEditar();
  const irA = (mes) => () => {
    estado.mes = mes;
    render();
  };

  return [
    h('div', { class: 'periodo' },
      h('button', { type: 'button', class: 'cuadrado', onclick: irA(moverMes(estado.mes, -1)), 'aria-label': 'Mes anterior' }, '‹'),
      h('h2', null, nombreMes(estado.mes)),
      h('button', { type: 'button', class: 'cuadrado', onclick: irA(siguiente), 'aria-label': 'Mes siguiente' }, '›'),
      estado.mes !== hoy().slice(0, 7) && h('button', { type: 'button', onclick: irA(hoy().slice(0, 7)) }, 'Hoy'),
      h('span', { class: 'espacio' }),
      editar && h('button', { type: 'button', class: 'primario', onclick: () => abrirMovimiento() }, '+ Nuevo movimiento'),
    ),

    h('div', { class: 'tarjetas' },
      tarjeta('Ingresos del mes', dinero(t.ingresos), t.ingresosPendientes > 0 && `${dinero(t.ingresosPendientes)} por recibir`, 'ingreso'),
      tarjeta('Gastos del mes', dinero(t.gastos), `${dinero(t.gastos - t.gastosPendientes)} ya pagado`, 'gasto'),
      tarjeta('Balance del mes', dinero(t.balance), 'Ingresos menos gastos', 'destacada'),
      tarjeta('Falta por pagar', dinero(t.gastosPendientes), 'Gastos de este mes sin pagar'),
    ),

    h('div', { class: 'dos-columnas' },
      h('section', { class: 'panel' },
        h('header', null,
          h('h3', null, 'Pagos y cobros pendientes'),
          h('span', { class: 'tenue' }, 'vencidos y próximos 30 días'),
        ),
        pendientes.movimientos.length === 0
          ? h('p', { class: 'vacio' }, 'No hay nada pendiente. ¡Todo al día!')
          : h('ul', { class: 'lista' },
              pendientes.movimientos.map((m) =>
                h('li', null,
                  h('div', { class: 'cuerpo' },
                    h('div', null, m.descripcion),
                    h('small', null, `${fechaCorta(m.fecha)} · ${m.categoria} `),
                    m.fecha < hoy() && chipEstado(m),
                  ),
                  h('div', { class: 'monto' }, montoConSigno(m)),
                  editar && h('button', { type: 'button', class: 'mini', onclick: () => marcarPagado(m, true) },
                    m.tipo === 'gasto' ? 'Pagar' : 'Recibido'),
                ),
              ),
            ),
      ),

      h('section', { class: 'panel' },
        h('header', null,
          h('h3', null, `Próximo mes: ${nombreMes(siguiente, { month: 'long' })}`),
          h('button', { type: 'button', class: 'enlace', onclick: irA(siguiente) }, 'ver detalle'),
        ),
        h('table', null,
          h('tbody', null,
            h('tr', null, h('td', null, 'Ingresos previstos'), h('td', { class: 'monto ingreso' }, dinero(tp.ingresos))),
            h('tr', null, h('td', null, 'Gastos previstos'), h('td', { class: 'monto gasto' }, dinero(tp.gastos))),
          ),
          h('tfoot', null,
            h('tr', null, h('td', null, 'Balance previsto'), h('td', { class: `monto ${claseBalance(tp.balance)}` }, dinero(tp.balance))),
          ),
        ),
        proximo.movimientos.length === 0 &&
          h('p', { class: 'tenue' }, 'Aún no hay movimientos el mes que viene. Usa «Repetir cada mes» al crear gastos fijos para verlos aquí.'),
      ),
    ),

    h('section', { class: 'panel' },
      h('header', null, h('h3', null, 'Movimientos del mes'), h('span', { class: 'tenue' }, `${actual.movimientos.length}`)),
      actual.movimientos.length === 0
        ? h('p', { class: 'vacio' }, 'No hay movimientos este mes.')
        : h('div', { class: 'tabla-scroll' },
            h('table', { class: 'tabla-mov' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Fecha'),
                  h('th', null, 'Descripción'),
                  h('th', { class: 'ocultar-movil' }, 'Categoría'),
                  h('th', null, 'Estado'),
                  h('th', { class: 'monto' }, 'Monto'),
                  editar && h('th', null),
                ),
              ),
              h('tbody', null,
                actual.movimientos.map((m) =>
                  h('tr', null,
                    h('td', null, fechaCorta(m.fecha)),
                    h('td', null, m.descripcion, m.enSerie && h('span', { class: 'tenue', title: 'Se repite cada mes' }, ' ↻')),
                    h('td', { class: 'ocultar-movil' }, m.categoria),
                    h('td', null, chipEstado(m)),
                    h('td', { class: 'monto' }, montoConSigno(m)),
                    editar && h('td', { class: 'acciones-fila' },
                      h('button', { type: 'button', class: 'mini', onclick: () => marcarPagado(m, !m.pagado) },
                        m.pagado ? 'Desmarcar' : m.tipo === 'gasto' ? 'Pagar' : 'Recibido'),
                      h('button', { type: 'button', class: 'mini', onclick: () => abrirMovimiento(m) }, 'Editar'),
                      h('button', { type: 'button', class: 'mini peligro', onclick: () => eliminarMovimiento(m), 'aria-label': `Eliminar ${m.descripcion}` }, '✕'),
                    ),
                  ),
                ),
              ),
            ),
          ),
    ),
  ];
}

// ---------- vista: año ----------

async function vistaAnio() {
  const r = await api(`/libros/${estado.libroId}/resumen?anio=${estado.anio}`);
  const t = r.totales;
  const maximo = Math.max(1, ...r.meses.flatMap((m) => [m.ingresos, m.gastos]));
  const claveMes = (m) => `${r.anio}-${String(m.mes).padStart(2, '0')}`;
  const abrirMes = (m) => () => {
    estado.mes = claveMes(m);
    estado.vista = 'mes';
    render();
  };
  const irA = (anio) => () => {
    estado.anio = anio;
    render();
  };
  const gastosCat = r.categorias.filter((c) => c.tipo === 'gasto');
  const ingresosCat = r.categorias.filter((c) => c.tipo === 'ingreso');
  const anioActual = Number(hoy().slice(0, 4));

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

  return [
    h('div', { class: 'periodo' },
      h('button', { type: 'button', class: 'cuadrado', onclick: irA(r.anio - 1), 'aria-label': 'Año anterior' }, '‹'),
      h('h2', null, String(r.anio)),
      h('button', { type: 'button', class: 'cuadrado', onclick: irA(r.anio + 1), 'aria-label': 'Año siguiente' }, '›'),
      r.anio !== anioActual && h('button', { type: 'button', onclick: irA(anioActual) }, 'Este año'),
    ),

    h('div', { class: 'tarjetas' },
      tarjeta('Ingresos del año', dinero(t.ingresos), t.ingresosPendientes > 0 && `${dinero(t.ingresosPendientes)} por recibir`, 'ingreso'),
      tarjeta('Gastos del año', dinero(t.gastos), `${dinero(t.gastosPagados)} ya pagado`, 'gasto'),
      tarjeta('Balance del año', dinero(t.balance), 'Ingresos menos gastos', 'destacada'),
      tarjeta('Falta por pagar', dinero(t.gastosPendientes), 'Gastos del año sin pagar'),
    ),

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
            onclick: abrirMes(m),
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
              h('tr', { class: 'clic', onclick: abrirMes(m) },
                h('td', { class: 'capital' }, nombreMes(claveMes(m), { month: 'long' })),
                h('td', { class: 'monto' }, dinero(m.ingresos)),
                h('td', { class: 'monto' }, dinero(m.gastos)),
                h('td', { class: 'monto ocultar-movil' }, dinero(m.gastosPendientes)),
                h('td', { class: `monto ${claseBalance(m.balance)}` }, dinero(m.balance)),
              ),
            ),
          ),
          h('tfoot', null,
            h('tr', null,
              h('td', null, `Total ${r.anio}`),
              h('td', { class: 'monto' }, dinero(t.ingresos)),
              h('td', { class: 'monto' }, dinero(t.gastos)),
              h('td', { class: 'monto ocultar-movil' }, dinero(t.gastosPendientes)),
              h('td', { class: `monto ${claseBalance(t.balance)}` }, dinero(t.balance)),
            ),
          ),
        ),
      ),
    ),

    h('div', { class: 'dos-columnas' },
      tablaCategorias('Gastos por categoría', gastosCat, t.gastos),
      tablaCategorias('Ingresos por categoría', ingresosCat, t.ingresos),
    ),
  ];
}

// ---------- vista: compartir ----------

async function vistaCompartir() {
  const libro = libroActual();
  const base = `/libros/${libro.id}`;
  const { miembros } = await api(`${base}/miembros`);
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
                h('td', null, m.nombre, m.id === estado.usuario.id && ' (tú)', h('div', { class: 'tenue' }, m.email)),
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
          h('header', null, h('h3', null, 'Compartir este libro')),
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

// ---------- render ----------

const VISTAS = { mes: vistaMes, anio: vistaAnio, compartir: vistaCompartir };
let turno = 0;

async function render() {
  const miTurno = ++turno;
  const cont = $('#contenido');
  for (const boton of $('#pestanas').children) {
    if (boton.dataset.vista === estado.vista) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  }
  if (!libroActual()) {
    cont.replaceChildren(h('p', { class: 'vacio' }, 'No tienes ningún libro. Crea uno con «+ Libro».'));
    return;
  }
  try {
    const nodos = await VISTAS[estado.vista]();
    // Si mientras cargaba se pidió otra vista, se descarta este resultado.
    if (miTurno === turno) cont.replaceChildren(...nodos.filter(Boolean));
  } catch (err) {
    if (miTurno === turno) cont.replaceChildren(h('p', { class: 'vacio error' }, err.message));
  }
}

$('#pestanas').addEventListener('click', (ev) => {
  const vista = ev.target.dataset?.vista;
  if (!vista) return;
  estado.vista = vista;
  render();
});

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
