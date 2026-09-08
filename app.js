/* =========================================================
   Drive Uploader — lógica de la aplicación
   Consume la API RESTful de Google Drive v3.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   1. Configuración
   Mientras mantenga vacío mi código de cliente, la app correrá en modo demostración:
   la interfaz funciona completa pero nada enviará, realmente a Drive.
   --------------------------------------------------------- */
const CONFIG = {
  CLIENT_ID: '414615214184-ishlqpcd8kt8p3o71u723fhbvai1ql7b.apps.googleusercontent.com',
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  API_ARCHIVOS: 'https://www.googleapis.com/drive/v3/files',
  API_SUBIDA: 'https://www.googleapis.com/upload/drive/v3/files',
  TIPO_CARPETA: 'application/vnd.google-apps.folder'
};

const MODO_DEMO = CONFIG.CLIENT_ID.trim() === '';

/* ---------------------------------------------------------
   2. Estado de la aplicación
   --------------------------------------------------------- */
const estado = {
  token: null,
  cola: [],          // { id, archivo, avance, situacion }
  enviando: false,
  siguienteId: 1,
  carpetaActual: null,   // ID de la carpeta que se está mostrando
  consultando: false,
  subidosHoy: []         // IDs de los archivos enviados en esta sesión
};

/* ---------------------------------------------------------
   3. Referencias al DOM
   --------------------------------------------------------- */
const el = {
  btnConectar:   document.getElementById('btnConectar'),
  estadoConexion:document.getElementById('estadoConexion'),
  avisoGlobal:   document.getElementById('avisoGlobal'),
  modoNombre:    document.getElementById('modoNombre'),
  modoId:        document.getElementById('modoId'),
  campoNombre:   document.getElementById('campoNombre'),
  campoId:       document.getElementById('campoId'),
  carpetaNombre: document.getElementById('carpetaNombre'),
  carpetaId:     document.getElementById('carpetaId'),
  resumenDestino:document.getElementById('resumenDestino'),
  destinoTexto:  document.getElementById('destinoTexto'),
  zonaSoltar:    document.getElementById('zonaSoltar'),
  selector:      document.getElementById('selectorArchivos'),
  lista:         document.getElementById('listaArchivos'),
  contador:      document.getElementById('contadorArchivos'),
  btnLimpiar:    document.getElementById('btnLimpiar'),
  btnSubir:      document.getElementById('btnSubir'),
  barraTotal:    document.getElementById('barraTotal'),
  mensaje:       document.getElementById('mensajeEstado'),
  btnRefrescar:  document.getElementById('btnRefrescar'),
  contenidoResumen: document.getElementById('contenidoResumen'),
  tablaEnvoltorio:  document.querySelector('.tabla-envoltorio'),
  cuerpoContenido:  document.getElementById('cuerpoContenido'),
  contenidoVacio:   document.getElementById('contenidoVacio')
};

/* ---------------------------------------------------------
   4. Utilidades
   --------------------------------------------------------- */
function formatearPeso(bytes) {
  if (bytes === 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + unidades[i];
}

function mostrarAviso(texto) {
  el.avisoGlobal.textContent = texto;
  el.avisoGlobal.classList.remove('d-none');
}

function fijarMensaje(texto, tipo) {
  el.mensaje.textContent = texto;
  el.mensaje.className = 'mensaje-estado';
  if (tipo) el.mensaje.classList.add('es-' + tipo);
}

/* ---------------------------------------------------------
   5. Autorización con Google (OAuth 2.0)
   --------------------------------------------------------- */
let clienteToken = null;

function prepararAutorizacion() {
  if (MODO_DEMO) {
    mostrarAviso(
      'Modo demostración: falta configurar el Client ID en js/app.js, ' +
      'así que los envíos se simulan y no llegan a Drive.'
    );
    return;
  }

  clienteToken = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPE,
    callback: (respuesta) => {
      if (respuesta.error) {
        fijarMensaje('Google no autorizó la sesión. Vuelve a intentarlo.', 'error');
        return;
      }
      estado.token = respuesta.access_token;
      marcarConectado();
    }
  });
}

function marcarConectado() {
  el.estadoConexion.className = 'estado estado--on';
  el.estadoConexion.innerHTML = '<span class="estado-punto"></span>Conectado';
  el.btnConectar.textContent = 'Sesión activa';
  el.btnConectar.disabled = true;
  fijarMensaje('Cuenta enlazada. Ya puedes enviar.');
  revisarSiPuedeSubir();
  el.btnRefrescar.disabled = false;
  programarActualizacion(0);          // carga automática al conectar
}

el.btnConectar.addEventListener('click', () => {
  if (MODO_DEMO) {
    estado.token = 'demo';
    marcarConectado();
    return;
  }
  clienteToken.requestAccessToken();
});

/* ---------------------------------------------------------
   6. Carpeta destino
   --------------------------------------------------------- */
function cambiarModoDestino() {
  const porNombre = el.modoNombre.checked;
  el.campoNombre.classList.toggle('d-none', !porNombre);
  el.campoId.classList.toggle('d-none', porNombre);
  actualizarResumenDestino();
  revisarSiPuedeSubir();
  programarActualizacion(0);
}

function actualizarResumenDestino() {
  const valor = el.modoNombre.checked
    ? el.carpetaNombre.value.trim()
    : el.carpetaId.value.trim();

  if (valor === '') {
    el.resumenDestino.classList.add('d-none');
    return;
  }

  el.destinoTexto.textContent = el.modoNombre.checked
    ? 'Carpeta "' + valor + '"'
    : 'Carpeta con ID ' + valor;
  el.resumenDestino.classList.remove('d-none');
}

el.modoNombre.addEventListener('change', cambiarModoDestino);
el.modoId.addEventListener('change', cambiarModoDestino);
el.carpetaNombre.addEventListener('input', () => {
  actualizarResumenDestino();
  revisarSiPuedeSubir();
  programarActualizacion();
});

el.carpetaId.addEventListener('input', () => {
  actualizarResumenDestino();
  revisarSiPuedeSubir();
  programarActualizacion();
});

/* Busca la carpeta destino y devuelve su ID, o null si todavía no existe.
   No crea nada: se usa tanto al enviar como al listar el contenido. */
async function buscarCarpetaId() {
  if (el.modoId.checked) {
    const id = el.carpetaId.value.trim();
    return id === '' ? null : id;
  }

  const nombre = el.carpetaNombre.value.trim().replace(/'/g, "\\'");
  if (nombre === '') return null;
  if (MODO_DEMO) return 'demo-folder-id';

  // GET /drive/v3/files — búsqueda por nombre y tipo carpeta
  const consulta = encodeURIComponent(
    "mimeType='" + CONFIG.TIPO_CARPETA + "' and name='" + nombre + "' and trashed=false"
  );
  const busqueda = await fetch(
    CONFIG.API_ARCHIVOS + '?q=' + consulta + '&fields=files(id,name)',
    { headers: { Authorization: 'Bearer ' + estado.token } }
  );
  if (!busqueda.ok) throw new Error('No se pudo consultar tu Drive.');

  const datos = await busqueda.json();
  return (datos.files && datos.files.length > 0) ? datos.files[0].id : null;
}

/* Devuelve el ID de la carpeta destino y la crea si hace falta. */
async function resolverCarpeta() {
  const encontrada = await buscarCarpetaId();
  if (encontrada) return encontrada;
  if (el.modoId.checked) throw new Error('Escribe el ID de la carpeta destino.');

  const nombre = el.carpetaNombre.value.trim().replace(/'/g, "\\'");

  // POST /drive/v3/files — creación de la carpeta
  const creacion = await fetch(CONFIG.API_ARCHIVOS, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + estado.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: nombre, mimeType: CONFIG.TIPO_CARPETA })
  });
  if (!creacion.ok) throw new Error('No se pudo crear la carpeta.');

  const carpeta = await creacion.json();
  return carpeta.id;
}

/* ---------------------------------------------------------
   7. Contenido de la carpeta (listado dinámico)

   Aquí se consume la API con el método GET y la respuesta en
   JSON se recorre para construir las filas de la tabla en el
   DOM. Es la parte de la app donde los datos que se muestran
   provienen del servicio y no del propio navegador.
   --------------------------------------------------------- */

const NOMBRES_TIPO = {
  'application/vnd.google-apps.folder':      'Carpeta',
  'application/vnd.google-apps.document':    'Documento de Google',
  'application/vnd.google-apps.spreadsheet': 'Hoja de cálculo',
  'application/vnd.google-apps.presentation':'Presentación',
  'application/pdf':  'PDF',
  'image/png':        'Imagen PNG',
  'image/jpeg':       'Imagen JPEG',
  'text/plain':       'Texto',
  'text/csv':         'CSV',
  'application/zip':  'Comprimido',
  'video/mp4':        'Video MP4'
};

const ICONO_CARPETA =
  '<svg class="icono-tipo icono-tipo--carpeta" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" ' +
  'fill="currentColor"/></svg>';

const ICONO_ARCHIVO =
  '<svg class="icono-tipo" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>';

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

function nombreTipo(mime) {
  if (NOMBRES_TIPO[mime]) return NOMBRES_TIPO[mime];
  if (!mime) return 'Archivo';
  if (mime.startsWith('image/')) return 'Imagen';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  return 'Archivo';
}

/* Datos ficticios para el modo demostración. */
function contenidoDemo() {
  const ahora = Date.now();
  const base = [
    { id: 'd1', name: 'Apuntes de la sesión 4.pdf', mimeType: 'application/pdf',
      size: '284913', modifiedTime: new Date(ahora - 36e5 * 5).toISOString() },
    { id: 'd2', name: 'Evidencias', mimeType: CONFIG.TIPO_CARPETA,
      modifiedTime: new Date(ahora - 864e5 * 2).toISOString() },
    { id: 'd3', name: 'Control de lecturas.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: '18422', modifiedTime: new Date(ahora - 864e5 * 6).toISOString() },
    { id: 'd4', name: 'Portada institucional.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: '75310', modifiedTime: new Date(ahora - 864e5 * 11).toISOString() }
  ];

  // Se agregan los archivos que se "enviaron" durante la demostración
  const enviados = estado.cola
    .filter((i) => i.situacion === 'listo')
    .map((i) => ({
      id: 'demo-' + i.id,
      name: i.archivo.name,
      mimeType: i.archivo.type || 'application/octet-stream',
      size: String(i.archivo.size),
      modifiedTime: new Date().toISOString()
    }));

  return enviados.concat(base);
}

/* Petición GET a la API: pide los archivos cuyo padre es la carpeta destino. */
async function pedirContenido(carpetaId) {
  if (MODO_DEMO) {
    await new Promise((r) => setTimeout(r, 450));   // simula la latencia de red
    return contenidoDemo();
  }

  const consulta = encodeURIComponent("'" + carpetaId + "' in parents and trashed=false");
  const campos = encodeURIComponent(
    'files(id,name,mimeType,size,modifiedTime,webViewLink)'
  );
  const respuesta = await fetch(
    CONFIG.API_ARCHIVOS +
    '?q=' + consulta +
    '&fields=' + campos +
    '&orderBy=folder,modifiedTime desc' +
    '&pageSize=100',
    { headers: { Authorization: 'Bearer ' + estado.token } }
  );

  if (respuesta.status === 401) throw new Error('La sesión expiró. Vuelve a conectar tu cuenta.');
  if (!respuesta.ok) throw new Error('Drive respondió ' + respuesta.status + ' al pedir la lista.');

  const datos = await respuesta.json();
  return datos.files || [];
}

/* Construye las filas de la tabla a partir de la respuesta del servicio. */
function dibujarContenido(archivos) {
  el.cuerpoContenido.innerHTML = '';

  if (archivos.length === 0) {
    el.tablaEnvoltorio.classList.remove('visible');
    mostrarNotaContenido('La carpeta está vacía por ahora. Envía archivos y vuelve a actualizar.');
    return;
  }

  archivos.forEach((archivo) => {
    const esCarpeta = archivo.mimeType === CONFIG.TIPO_CARPETA;
    const fila = document.createElement('tr');
    if (estado.subidosHoy.includes(archivo.id)) fila.classList.add('recien-subido');

    // Nombre, con icono según el tipo
    const celdaNombre = document.createElement('td');
    const envoltorio = document.createElement('div');
    envoltorio.className = 'celda-nombre';
    envoltorio.innerHTML = esCarpeta ? ICONO_CARPETA : ICONO_ARCHIVO;
    const texto = document.createElement('span');
    texto.className = 'texto';
    texto.textContent = archivo.name;          // textContent: evita inyección de HTML
    texto.title = archivo.name;
    envoltorio.append(texto);
    celdaNombre.append(envoltorio);

    const celdaTipo = document.createElement('td');
    celdaTipo.className = 'celda-tipo';
    celdaTipo.textContent = nombreTipo(archivo.mimeType);

    const celdaPeso = document.createElement('td');
    celdaPeso.className = 'celda-num';
    celdaPeso.textContent = archivo.size ? formatearPeso(Number(archivo.size)) : '—';

    const celdaFecha = document.createElement('td');
    celdaFecha.className = 'celda-fecha';
    celdaFecha.textContent = archivo.modifiedTime
      ? FECHA_LARGA.format(new Date(archivo.modifiedTime))
      : '—';

    const celdaEnlace = document.createElement('td');
    if (archivo.webViewLink) {
      const enlace = document.createElement('a');
      enlace.className = 'enlace-drive';
      enlace.href = archivo.webViewLink;
      enlace.target = '_blank';
      enlace.rel = 'noopener';
      enlace.textContent = 'Abrir';
      celdaEnlace.append(enlace);
    }

    fila.append(celdaNombre, celdaTipo, celdaPeso, celdaFecha, celdaEnlace);
    el.cuerpoContenido.append(fila);
  });

  el.tablaEnvoltorio.classList.add('visible');
  el.contenidoVacio.classList.add('d-none');

  const carpetas = archivos.filter((a) => a.mimeType === CONFIG.TIPO_CARPETA).length;
  const sueltos = archivos.length - carpetas;
  const partes = [];
  if (sueltos > 0) partes.push(sueltos + (sueltos === 1 ? ' archivo' : ' archivos'));
  if (carpetas > 0) partes.push(carpetas + (carpetas === 1 ? ' carpeta' : ' carpetas'));
  el.contenidoResumen.textContent =
    partes.join(' y ') + ' · actualizado a las ' +
    new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function mostrarNotaContenido(texto, esError) {
  el.tablaEnvoltorio.classList.remove('visible');
  el.cuerpoContenido.innerHTML = '';
  el.contenidoVacio.textContent = texto;
  el.contenidoVacio.classList.remove('d-none');
  el.contenidoVacio.classList.toggle('es-error', Boolean(esError));
}

/* Orquesta la consulta: valida requisitos, pide y dibuja. */
async function actualizarContenido() {
  if (estado.consultando) return;

  if (!estado.token) {
    el.contenidoResumen.textContent = 'Conecta tu cuenta y elige un destino para ver su contenido.';
    mostrarNotaContenido('Aquí aparecerán los archivos que Drive reporte en la carpeta destino.');
    return;
  }

  const hayDestino = el.modoNombre.checked
    ? el.carpetaNombre.value.trim() !== ''
    : el.carpetaId.value.trim() !== '';

  if (!hayDestino) {
    el.contenidoResumen.textContent = 'Falta el destino: escribe el nombre o el ID de la carpeta.';
    mostrarNotaContenido('Aquí aparecerán los archivos que Drive reporte en la carpeta destino.');
    return;
  }

  estado.consultando = true;
  el.btnRefrescar.classList.add('girando');
  el.btnRefrescar.disabled = true;
  el.contenidoResumen.textContent = 'Consultando Drive…';

  try {
    const carpetaId = await buscarCarpetaId();

    if (!carpetaId) {
      estado.carpetaActual = null;
      el.contenidoResumen.textContent = 'Esa carpeta todavía no existe.';
      mostrarNotaContenido('Se creará automáticamente cuando envíes el primer archivo.');
      return;
    }

    estado.carpetaActual = carpetaId;
    const archivos = await pedirContenido(carpetaId);
    dibujarContenido(archivos);

  } catch (error) {
    el.contenidoResumen.textContent = 'No se pudo leer la carpeta.';
    mostrarNotaContenido(error.message, true);

  } finally {
    estado.consultando = false;
    el.btnRefrescar.classList.remove('girando');
    el.btnRefrescar.disabled = !estado.token;
  }
}

el.btnRefrescar.addEventListener('click', actualizarContenido);

/* Carga automática: espera a que el usuario deje de escribir el destino. */
let relojDestino = null;
function programarActualizacion(retraso) {
  clearTimeout(relojDestino);
  relojDestino = setTimeout(actualizarContenido, retraso === undefined ? 800 : retraso);
}

/* ---------------------------------------------------------
   8. Cola de archivos
   --------------------------------------------------------- */
function agregarArchivos(archivos) {
  Array.from(archivos).forEach((archivo) => {
    const repetido = estado.cola.some(
      (i) => i.archivo.name === archivo.name && i.archivo.size === archivo.size
    );
    if (repetido) return;

    estado.cola.push({
      id: estado.siguienteId++,
      archivo: archivo,
      avance: 0,
      situacion: 'espera'
    });
  });

  dibujarLista();
  revisarSiPuedeSubir();
}

function quitarArchivo(id) {
  estado.cola = estado.cola.filter((i) => i.id !== id);
  dibujarLista();
  revisarSiPuedeSubir();
}

const ETIQUETAS = {
  espera:   'En cola',
  subiendo: 'Enviando',
  listo:    'Enviado',
  falla:    'Falló'
};

function dibujarLista() {
  el.lista.innerHTML = '';

  if (estado.cola.length === 0) {
    el.lista.innerHTML =
      '<li class="lista-vacia">Los archivos que elijas aparecerán aquí antes de enviarse.</li>';
    el.contador.textContent = 'Nada en la cola';
    el.btnLimpiar.disabled = true;
    return;
  }

  const pesoTotal = estado.cola.reduce((suma, i) => suma + i.archivo.size, 0);
  el.contador.textContent =
    estado.cola.length + (estado.cola.length === 1 ? ' archivo · ' : ' archivos · ') +
    formatearPeso(pesoTotal);
  el.btnLimpiar.disabled = estado.enviando;

  estado.cola.forEach((item) => {
    const fila = document.createElement('li');
    fila.className = 'fila';
    fila.dataset.id = item.id;

    const avance = document.createElement('div');
    avance.className = 'fila-avance';
    avance.style.width = item.avance + '%';

    const datos = document.createElement('div');
    datos.className = 'fila-datos';
    datos.innerHTML =
      '<div class="fila-nombre"></div><div class="fila-peso"></div>';
    datos.querySelector('.fila-nombre').textContent = item.archivo.name;
    datos.querySelector('.fila-peso').textContent = formatearPeso(item.archivo.size);

    const marca = document.createElement('span');
    marca.className = 'fila-marca fila-marca--' + item.situacion;
    marca.textContent = item.situacion === 'subiendo'
      ? item.avance + '%'
      : ETIQUETAS[item.situacion];

    fila.append(avance, datos, marca);

    if (!estado.enviando && item.situacion === 'espera') {
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'fila-quitar';
      quitar.setAttribute('aria-label', 'Quitar ' + item.archivo.name);
      quitar.textContent = '×';
      quitar.addEventListener('click', () => quitarArchivo(item.id));
      fila.append(quitar);
    }

    el.lista.append(fila);
  });
}

function actualizarFila(item) {
  const fila = el.lista.querySelector('[data-id="' + item.id + '"]');
  if (!fila) return;
  fila.querySelector('.fila-avance').style.width = item.avance + '%';
  const marca = fila.querySelector('.fila-marca');
  marca.className = 'fila-marca fila-marca--' + item.situacion;
  marca.textContent = item.situacion === 'subiendo'
    ? item.avance + '%'
    : ETIQUETAS[item.situacion];
}

el.btnLimpiar.addEventListener('click', () => {
  estado.cola = [];
  el.barraTotal.style.width = '0%';
  fijarMensaje('Cola vacía.');
  dibujarLista();
  revisarSiPuedeSubir();
});

/* ---------------------------------------------------------
   9. Arrastrar y soltar
   --------------------------------------------------------- */
el.zonaSoltar.addEventListener('click', () => el.selector.click());

el.zonaSoltar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.selector.click();
  }
});

el.selector.addEventListener('change', (e) => {
  agregarArchivos(e.target.files);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((evento) => {
  el.zonaSoltar.addEventListener(evento, (e) => {
    e.preventDefault();
    el.zonaSoltar.classList.add('activa');
  });
});

['dragleave', 'drop'].forEach((evento) => {
  el.zonaSoltar.addEventListener(evento, (e) => {
    e.preventDefault();
    el.zonaSoltar.classList.remove('activa');
  });
});

el.zonaSoltar.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length > 0) agregarArchivos(e.dataTransfer.files);
});

// Evita que el navegador abra un archivo soltado fuera de la zona
['dragover', 'drop'].forEach((evento) => {
  window.addEventListener(evento, (e) => e.preventDefault());
});

/* ---------------------------------------------------------
   10. Envío a Drive
   --------------------------------------------------------- */
function revisarSiPuedeSubir() {
  const hayDestino = el.modoNombre.checked
    ? el.carpetaNombre.value.trim() !== ''
    : el.carpetaId.value.trim() !== '';

  el.btnSubir.disabled = !(estado.token && hayDestino &&
                           estado.cola.length > 0 && !estado.enviando);
}

/* Subida multiparte: metadatos + contenido en una sola petición.
   Se usa XMLHttpRequest porque expone el evento de progreso. */
function subirArchivo(item, carpetaId) {
  return new Promise((resolver, rechazar) => {

    if (MODO_DEMO) {                       // simulación para pruebas locales
      let p = 0;
      const reloj = setInterval(() => {
        p += 10;
        item.avance = Math.min(p, 100);
        actualizarFila(item);
        actualizarBarraTotal();
        if (p >= 100) { clearInterval(reloj); resolver(); }
      }, 90);
      return;
    }

    const metadatos = { name: item.archivo.name, parents: [carpetaId] };
    const cuerpo = new FormData();
    cuerpo.append('metadata', new Blob([JSON.stringify(metadatos)],
                  { type: 'application/json' }));
    cuerpo.append('file', item.archivo);

    const peticion = new XMLHttpRequest();
    peticion.open('POST', CONFIG.API_SUBIDA + '?uploadType=multipart&fields=id,name');
    peticion.setRequestHeader('Authorization', 'Bearer ' + estado.token);

    peticion.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      item.avance = Math.round((e.loaded / e.total) * 100);
      actualizarFila(item);
      actualizarBarraTotal();
    });

    peticion.addEventListener('load', () => {
      if (peticion.status >= 200 && peticion.status < 300) {
        // Drive devuelve los datos del archivo creado; se conservan
        // para resaltarlo después en el listado de la carpeta.
        try { resolver(JSON.parse(peticion.responseText)); }
        catch (e) { resolver(null); }
      } else {
        rechazar(new Error('Drive respondió ' + peticion.status));
      }
    });

    peticion.addEventListener('error', () => rechazar(new Error('Se cortó la conexión.')));
    peticion.send(cuerpo);
  });
}

function actualizarBarraTotal() {
  const suma = estado.cola.reduce((t, i) => t + i.avance, 0);
  const total = Math.round(suma / estado.cola.length);
  el.barraTotal.style.width = total + '%';
  el.barraTotal.parentElement.setAttribute('aria-valuenow', total);
}

el.btnSubir.addEventListener('click', async () => {
  estado.enviando = true;
  revisarSiPuedeSubir();
  el.btnLimpiar.disabled = true;
  fijarMensaje('Preparando el destino…');

  let carpetaId;
  try {
    carpetaId = await resolverCarpeta();
  } catch (error) {
    fijarMensaje(error.message, 'error');
    estado.enviando = false;
    revisarSiPuedeSubir();
    return;
  }

  let enviados = 0;
  let fallidos = 0;

  for (const item of estado.cola) {
    if (item.situacion === 'listo') { enviados++; continue; }

    item.situacion = 'subiendo';
    dibujarLista();
    fijarMensaje('Enviando ' + item.archivo.name + '…');

    try {
      const creado = await subirArchivo(item, carpetaId);
      if (creado && creado.id) estado.subidosHoy.push(creado.id);
      item.situacion = 'listo';
      item.avance = 100;
      enviados++;
    } catch (error) {
      item.situacion = 'falla';
      fallidos++;
    }
    actualizarFila(item);
    actualizarBarraTotal();
  }

  estado.enviando = false;
  dibujarLista();
  revisarSiPuedeSubir();
  actualizarContenido();          // la carpeta cambió: se vuelve a consultar

  if (fallidos === 0) {
    fijarMensaje(enviados + ' archivo(s) en tu carpeta de Drive.', 'exito');
  } else {
    fijarMensaje(enviados + ' enviados, ' + fallidos + ' con problemas. Revisa la lista.', 'error');
  }
});

/* ---------------------------------------------------------
   11. Arranque
   --------------------------------------------------------- */
window.addEventListener('load', () => {
  prepararAutorizacion();
  dibujarLista();
  revisarSiPuedeSubir();
});
