/* =====================================================================
   WaterQualitySensors - lógica del frontend (JavaScript puro + Chart.js)

   Flujo del sistema:
   Sensores -> Cubecell -> Dragino (LoRaWAN) -> MongoDB -> Backend
   -> Random Forest (Buena | Aceptable | Riesgo | No apta)
   -> JSON -> Llama AI -> Backend -> esta interfaz

   Para conectar con el backend: poner usarDatosDemo en false y ajustar
   apiBase y endpoints. Cada función "cargar..." indica la forma del JSON.
   ===================================================================== */

const CONFIG = {
  usarDatosDemo: true,                    // false = consumir el backend real
  apiBase: "http://localhost:3000/api",   // URL base de la API; se concatena con cada ruta de endpoints
  endpoints: {
    login: "/auth/login",                 // POST {email, password} -> {token, usuario:{nombre, rol}}
    registro: "/auth/registro",           // POST {usuario, nombre, email, telefono, vereda, password}
    tanques: "/tanques",                  // GET  -> [{nodoId, nombre}]
    lecturas: "/lecturas",                // GET  ?nodoId=&desde=&hasta= -> [Lectura]
    alertas: "/alertas",                  // GET  -> [Alerta]
    chat: "/ia/chat",                     // POST {nodoId, pregunta} -> {respuesta}
    reporteIA: "/ia/reporte"              // GET  ?nodoId= -> {explicacion, recomendaciones[]}
  },
  minutosSinSenalParaDesconexion: 240     // Nodo "fuera de línea" si no hay paquetes en este tiempo
};

/*  Forma esperada de una Lectura (campos que debe devolver el backend):
    { nodoId, fecha (ISO), ph, turbidez, conductividad, temperatura,
      bateria (0-100), rssi (dBm), snr (dB),
      clasificacion: "Buena" | "Aceptable" | "Riesgo" | "No apta" }          */

// Límites y formato de cada medición. "margen" es la distancia al límite que activa una advertencia.
// "escala" configura el medidor visual y "decimales" el formato de los valores mostrados.
const UMBRALES = {
  ph:            { nombre: "pH",            unidad: "",      min: 6.5, max: 8.5,  margen: 0.3, escala: [0, 14],   decimales: 2 },
  turbidez:      { nombre: "Turbidez",      unidad: "NTU",   max: 5,             margen: 1,   escala: [0, 10],   decimales: 2 },
  conductividad: { nombre: "Conductividad", unidad: "µS/cm", min: 100, max: 1000, margen: 80,  escala: [0, 1400], decimales: 0 },
  temperatura:   { nombre: "Temperatura",   unidad: "°C",    min: 10,  max: 30,   margen: 2,   escala: [0, 40],   decimales: 1 }
};
// Nombres internos de las mediciones; se derivan de UMBRALES para mantener sincronizados los selectores.
const VARIABLES = Object.keys(UMBRALES);
// Relaciona la clasificación recibida del backend con la clase CSS usada para colorear su insignia.
const CLASES = { "Buena": "buena", "Aceptable": "aceptable", "Riesgo": "riesgo", "No apta": "no_apta" };

// La sesión temporal permite navegar entre páginas sin dejar la cuenta abierta al cerrar la pestaña.
const CLAVE_SESION = "WaterMLdetect-sesion";
let sesion = recuperarSesion();
let tanques = [];
let lecturas = [];
let alertas = [];
// Atajo para obtener elementos del HTML por su ID.
const $ = (id) => document.getElementById(id);
// Convierte una fecha ISO del backend al formato local usado en la interfaz.
const formatearFecha = (iso) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

function recuperarSesion() {
  const sesionGuardada = sessionStorage.getItem(CLAVE_SESION);
  if (!sesionGuardada) return null;
  try {
    return JSON.parse(sesionGuardada);
  } catch (error) {
    console.error("La sesión guardada no tiene un formato válido.", error);
    sessionStorage.removeItem(CLAVE_SESION);
    return null;
  }
}

/* ============================ API ============================ */

async function llamarApi(ruta, opciones = {}) {
  // Todas las solicitudes usan la URL base, JSON y, si existe, el token de la sesión activa.
  const respuesta = await fetch(CONFIG.apiBase + ruta, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion?.token ?? ""}` },
    ...opciones
  });
  if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);
  return respuesta.json();
}

/* ============================ DATOS DE DEMOSTRACIÓN ============================ */
// Sirven para ver la interfaz funcionando sin backend. Se descartan al conectar la API real.

// Crea una secuencia pseudoaleatoria repetible para que los datos de demostración no cambien en cada carga.
function generadorAleatorio(semilla) {
  return () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
}

// Genera mediciones de ejemplo para cada tanque con fecha, calidad y datos de conectividad.
function generarLecturasDemo() {
  const azar = generadorAleatorio(42);
  const ahora = Date.now();
  const resultado = [];
  tanques.forEach((tanque, indice) => {
    for (let hora = 30 * 24; hora >= 0; hora -= 3) {
      const ciclo = Math.sin(hora / 7);
      const lluvia = indice === 0 && hora < 30 ? (30 - hora) / 30 : 0;   // pico de turbidez reciente en el tanque 1
      const lectura = {
        nodoId: tanque.nodoId,
        fecha: new Date(ahora - hora * 3600000).toISOString(),
        ph: 7.3 + ciclo * 0.3 + azar() * 0.2 + lluvia * 1.0,
        turbidez: 1.6 + azar() * 0.9 + lluvia * 4.2,
        conductividad: 430 + ciclo * 60 + azar() * 50 + lluvia * 300,
        temperatura: 18 + Math.sin(hora / 4) * 2 + azar(),
        bateria: Math.max(12, 94 - (30 * 24 - hora) / 24 * 1.9 - indice * 25),
        rssi: -Math.round(95 + azar() * 20),
        snr: +(4 + azar() * 6).toFixed(1)
      };
      lectura.clasificacion = clasificarDemo(lectura);
      resultado.push(lectura);
    }
  });
  return resultado;
}

// Reemplazo temporal del Random Forest: el backend entregará la clasificación real.
function clasificarDemo(lectura) {
  const estados = ["ph", "turbidez", "conductividad"].map((variable) => estadoParametro(variable, lectura[variable]));
  const fueraDeRango = estados.filter((estado) => estado === "fuera").length;
  const cercaDelLimite = estados.filter((estado) => estado === "alerta").length;
  if (fueraDeRango >= 2) return "No apta";
  if (fueraDeRango === 1) return "Riesgo";
  return cercaDelLimite > 0 ? "Aceptable" : "Buena";
}

const REPORTES_DEMO = {
  "Buena": ["El agua del tanque está dentro de los límites recomendados. Es adecuada para el consumo habitual.", ["Mantén la tapa del tanque cerrada", "Haz la limpieza programada del tanque"]],
  "Aceptable": ["Algunos valores se acercan a los límites, pero el agua todavía está en rango tolerable.", ["Revisa el tanque en los próximos días", "Si es para beber, se recomienda hervirla"]],
  "Riesgo": ["Un parámetro está fuera del rango seguro, probablemente por arrastre de sedimentos tras lluvias.", ["Hierve el agua al menos 5 minutos antes de beberla", "Avisa al líder de la comunidad"]],
  "No apta": ["Varios parámetros están alterados. El agua no es segura para el consumo.", ["No consumas esta agua", "Usa una fuente alternativa y reporta al administrador local"]]
};

/* ============================ CARGA DE DATOS ============================ */

// Carga los nodos disponibles desde el backend o usa los tanques de ejemplo.
async function cargarTanques() {
  tanques = CONFIG.usarDatosDemo
    ? [{ nodoId: "nodo-01", nombre: "Tanque San Pedro 01" }, { nodoId: "nodo-02", nombre: "Tanque San Pedro 02" }]
    : await llamarApi(CONFIG.endpoints.tanques);
}

// Obtiene las lecturas y las ordena cronológicamente para facilitar filtros, gráficas e historial.
async function cargarLecturas() {
  lecturas = CONFIG.usarDatosDemo ? generarLecturasDemo() : await llamarApi(CONFIG.endpoints.lecturas);
  lecturas.sort((lecturaA, lecturaB) => new Date(lecturaA.fecha) - new Date(lecturaB.fecha));
}

// Solicita al backend la explicación y recomendaciones del nodo, o usa el reporte de demostración.
async function cargarReporteIA(nodoId, ultima) {
  if (CONFIG.usarDatosDemo) {
    const [explicacion, recomendaciones] = REPORTES_DEMO[ultima.clasificacion];
    return { explicacion, recomendaciones };
  }
  return llamarApi(`${CONFIG.endpoints.reporteIA}?nodoId=${nodoId}`);
}

// Carga alertas desde la API o las construye con las lecturas de demostración.
async function cargarAlertas() {
  alertas = CONFIG.usarDatosDemo ? generarAlertasDemo() : await llamarApi(CONFIG.endpoints.alertas);
  /* Forma de Alerta: { id, severidad: "critica"|"advertencia"|"resuelta", titulo, mensaje, fecha, nodoId, leida } */
}

// Simula alertas recientes a partir de mediciones que estén cerca o fuera de los límites.
function generarAlertasDemo() {
  const resultado = [];
  const recientes = lecturas.filter((lectura) => Date.now() - new Date(lectura.fecha) < 72 * 3600000).reverse();
  recientes.forEach((lectura) => {
    VARIABLES.forEach((variable) => {
      const estado = estadoParametro(variable, lectura[variable]);
      if (estado === "ok" || resultado.length >= 14) return;
      const antigua = Date.now() - new Date(lectura.fecha) > 36 * 3600000;
      resultado.push({
        id: `${lectura.nodoId}-${variable}-${lectura.fecha}`,
        severidad: antigua ? "resuelta" : estado === "fuera" ? "critica" : "advertencia",
        titulo: `${UMBRALES[variable].nombre} ${estado === "fuera" ? "fuera de norma" : "cerca del límite"} - ${nombreTanque(lectura.nodoId)}`,
        mensaje: `Valor registrado: ${lectura[variable].toFixed(UMBRALES[variable].decimales)} ${UMBRALES[variable].unidad}`,
        fecha: lectura.fecha, nodoId: lectura.nodoId, leida: false
      });
    });
  });
  return resultado;
}

/* ============================ UTILIDADES ============================ */

// Busca el nombre del tanque, filtra sus lecturas y obtiene la más reciente.
const nombreTanque = (nodoId) => tanques.find((tanque) => tanque.nodoId === nodoId)?.nombre ?? nodoId;
const lecturasDelNodo = (nodoId) => lecturas.filter((lectura) => lectura.nodoId === nodoId);
const ultimaLectura = (nodoId) => lecturasDelNodo(nodoId).at(-1);

// Devuelve "ok", "alerta" (cerca del límite) o "fuera" (incumple la norma)
function estadoParametro(variable, valor) {
  const configuracionVariable = UMBRALES[variable];
  if ((configuracionVariable.min !== undefined && valor < configuracionVariable.min) || (configuracionVariable.max !== undefined && valor > configuracionVariable.max)) return "fuera";
  if ((configuracionVariable.max !== undefined && valor > configuracionVariable.max - configuracionVariable.margen) || (configuracionVariable.min !== undefined && valor < configuracionVariable.min + configuracionVariable.margen)) return "alerta";
  return "ok";
}

// Devuelve el texto del rango de referencia configurado para la medición.
function descripcionRango(configuracionVariable) {
  if (configuracionVariable.min !== undefined && configuracionVariable.max !== undefined) return `Rango seguro: ${configuracionVariable.min} – ${configuracionVariable.max} ${configuracionVariable.unidad}`;
  return `Límite: menor a ${configuracionVariable.max} ${configuracionVariable.unidad}`;
}

/* ============================ NAVEGACIÓN ============================ */

// Muestra una sola vista y oculta las demás
function mostrarVista(idVista) {
  document.querySelector(".barra_lateral").classList.remove("abierta");
  document.querySelectorAll("#aplicacion .vista").forEach((vista) => (vista.hidden = vista.id !== idVista));
  document.querySelectorAll("#menu_principal button").forEach((boton) => boton.classList.toggle("activa", boton.dataset.vista === idVista));
  if (idVista === "vista_tendencias") actualizarTendencias();
  if (idVista === "vista_dashboard") dibujarGraficaPrincipal();
}

function entrarALaAplicacion() {
  sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  window.location.assign("dashboard.html");
}

function cerrarSesion() {
  sesion = null;
  sessionStorage.removeItem(CLAVE_SESION);
  window.location.assign("login.html");
}

/* ============================ AUTENTICACIÓN ============================ */

// Comprueba el formato del correo y los requisitos de longitud y complejidad de la contraseña.
const correoValido = (correo) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
const claveSegura = (clave) => clave.length >= 8 && clave.length <= 12 && /[A-Z]/.test(clave) && /\d/.test(clave) && /[^A-Za-z0-9]/.test(clave);

// Valida localmente el formulario de registro antes de enviarlo al backend.
function validarRegistro(datos) {
  if (Object.values(datos).some((valor) => !valor.trim())) return "Todos los campos son obligatorios.";
  if (!/^[a-zA-Z0-9]{1,50}$/.test(datos.usuario)) return "El usuario solo admite letras y números.";
  if (!correoValido(datos.email)) return "Formato de correo no válido.";
  if (!/^\d{10,15}$/.test(datos.telefono)) return "El teléfono debe tener entre 10 y 15 dígitos.";
  if (!claveSegura(datos.password)) return "La contraseña debe tener de 8 a 12 caracteres, con mayúscula, número y símbolo.";
  if (datos.password !== datos.confirmacion) return "Las contraseñas no coinciden.";
  return "";
}

// Envía las credenciales al endpoint de login y guarda los datos de sesión recibidos.
async function iniciarSesion(evento) {
  evento.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(evento.target));
  if (!email.trim() || !password) return ($("error_login").value = "Este campo es obligatorio.");
  if (!correoValido(email)) return ($("error_login").value = "Formato de correo no válido.");
  try {
    sesion = CONFIG.usarDatosDemo
      ? { nombre: email.split("@")[0], rol: "comunero", token: "demo" }
      : await llamarApi(CONFIG.endpoints.login, { method: "POST", body: JSON.stringify({ email, password }) }).then((respuestaLogin) => ({ ...respuestaLogin.usuario, token: respuestaLogin.token }));
    $("error_login").value = "";
  } catch {
    $("error_login").value = "El correo electrónico o la contraseña son incorrectos.";
    return;
  }
  entrarALaAplicacion();
}

// Valida los datos del formulario y crea la cuenta mediante el endpoint de registro.
async function registrarUsuario(evento) {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(evento.target));
  const error = validarRegistro(datos);
  $("error_registro").value = error;
  if (error) return;
  try {
    if (!CONFIG.usarDatosDemo) await llamarApi(CONFIG.endpoints.registro, { method: "POST", body: JSON.stringify(datos) });
    sesion = { nombre: datos.nombre, rol: "comunero", token: "demo" };
  } catch {
    $("error_registro").value = "No se pudo crear la cuenta. Revisa si el correo ya está registrado.";
    return;
  }
  entrarALaAplicacion();
}

/* ============================ DASHBOARD ============================ */

// Lee el ID del tanque elegido en el selector de la barra superior.
const nodoActual = () => $("selector_tanque").value;

// Actualiza los componentes del dashboard usando la última lectura del tanque seleccionado.
function actualizarDashboard() {
  const ultima = ultimaLectura(nodoActual());
  if (!ultima) return;
  $("fecha_ultima_lectura").textContent = formatearFecha(ultima.fecha);
  $("fecha_ultima_lectura").dateTime = ultima.fecha;
  renderTarjetasMetricas(ultima);
  renderClasificacion(ultima);
  renderEstadoRed(ultima);
  renderReporteIA(ultima);
  dibujarGraficaPrincipal();
}

// Construye las tarjetas de medición con su valor, unidad y estado respecto a los umbrales.
function renderTarjetasMetricas(ultima) {
  $("tarjetas_metricas").innerHTML = VARIABLES.map((variable) => {
    const configuracionVariable = UMBRALES[variable];
    const valor = ultima[variable];
    const estado = estadoParametro(variable, valor);
    const apoyo = variable === "temperatura" ? " (apoyo)" : "";
    const etiquetaEstado = { ok: "Normal", alerta: "Cerca del límite", fuera: "Fuera de rango" }[estado];
    return `<article class="tarjeta_metrica" data-estado="${estado}">
      <h3>${configuracionVariable.nombre}${apoyo}</h3>
      <output>${valor.toFixed(configuracionVariable.decimales)} <small>${configuracionVariable.unidad}</small></output>
      <meter min="${configuracionVariable.escala[0]}" max="${configuracionVariable.escala[1]}" low="${configuracionVariable.min ?? configuracionVariable.escala[0]}" high="${configuracionVariable.max}" optimum="${configuracionVariable.min !== undefined ? (configuracionVariable.min + configuracionVariable.max) / 2 : configuracionVariable.escala[0]}" value="${valor}"></meter>
      <p class="estado_parametro">${etiquetaEstado}</p>
      <small>${descripcionRango(configuracionVariable)}</small>
    </article>`;
  }).join("");
}

// Muestra la clasificación de calidad y asigna la clase CSS correspondiente.
function renderClasificacion(ultima) {
  const insignia = $("clasificacion_general");
  insignia.textContent = `Calidad: ${ultima.clasificacion}`;
  insignia.dataset.clase = CLASES[ultima.clasificacion];
}

// Presenta batería, señal y estado conectado/desconectado del nodo.
function renderEstadoRed(ultima) {
  const minutos = (Date.now() - new Date(ultima.fecha)) / 60000;
  const conectado = minutos <= CONFIG.minutosSinSenalParaDesconexion;
  const indicador = $("indicador_red");
  indicador.dataset.conectado = conectado ? "si" : "no";
  indicador.textContent = conectado ? "En línea" : "Sin señal reciente";
  $("red_nodo").textContent = ultima.nodoId;
  $("red_rssi").textContent = `${ultima.rssi} dBm`;
  $("red_snr").textContent = `${ultima.snr} dB`;
  $("red_bateria").value = ultima.bateria;
  $("red_bateria_texto").textContent = `${Math.round(ultima.bateria)} %`;
}

// Renderiza la explicación y recomendaciones recibidas del servicio de IA.
async function renderReporteIA(ultima) {
  try {
    const reporte = await cargarReporteIA(ultima.nodoId, ultima);
    $("ia_explicacion").textContent = reporte.explicacion;
    $("ia_recomendaciones").innerHTML = reporte.recomendaciones.map((recomendacion) => `<li>${recomendacion}</li>`).join("");
    $("ia_origen").textContent = `Basado en pH ${ultima.ph.toFixed(1)} y turbidez ${ultima.turbidez.toFixed(1)} NTU.`;
  } catch {
    // Mensaje de contingencia si Llama AI no responde
    $("ia_explicacion").textContent = "Explicación temporalmente no disponible. Guíate por la categoría de calidad y los valores del Dashboard.";
    $("ia_recomendaciones").innerHTML = "";
    $("ia_origen").textContent = "";
  }
}

function dibujarGraficaPrincipal() {
  const desde = Date.now() - 24 * 3600000;
  const datos = lecturasDelNodo(nodoActual()).filter((lectura) => new Date(lectura.fecha) >= desde);
  const variable = $("variable_grafica_principal").value;
  DashboardCharts.dibujar($("grafica_principal"), datos, variable, UMBRALES[variable]);
}

// Filtra las lecturas por periodo y variable, dibuja la gráfica y calcula el resumen estadístico.
function actualizarTendencias() {
  const { rango, variable } = Object.fromEntries(new FormData($("filtros_tendencias")));
  const desde = Date.now() - Number(rango) * 24 * 3600000;
  const datos = lecturasDelNodo(nodoActual()).filter((lectura) => new Date(lectura.fecha) >= desde);
  $("mensaje_sin_datos").hidden = datos.length > 0;
  if (!datos.length) { $("resumen_tendencia").innerHTML = ""; return; }
  DashboardCharts.dibujar($("grafica_tendencia"), datos, variable, UMBRALES[variable]);
  const valores = datos.map((lectura) => lectura[variable]);
  const configuracionVariable = UMBRALES[variable];
  const promedio = valores.reduce((total, valor) => total + valor, 0) / valores.length;
  const fueraDeRango = valores.filter((valor) => estadoParametro(variable, valor) === "fuera").length;
  $("resumen_tendencia").innerHTML = `
    <dt>Mínimo</dt><dd>${Math.min(...valores).toFixed(configuracionVariable.decimales)} ${configuracionVariable.unidad}</dd>
    <dt>Promedio</dt><dd>${promedio.toFixed(configuracionVariable.decimales)} ${configuracionVariable.unidad}</dd>
    <dt>Máximo</dt><dd>${Math.max(...valores).toFixed(configuracionVariable.decimales)} ${configuracionVariable.unidad}</dd>
    <dt>Muestras</dt><dd>${valores.length}</dd>
    <dt>Fuera de norma</dt><dd>${fueraDeRango}</dd>`;
}

/* ============================ LECTURAS ============================ */

// Muestra el nivel de batería y la fecha de la última señal de cada tanque.
function renderEstadoNodos() {
  $("estado_nodos").innerHTML = tanques.map((tanque) => {
    const ultima = ultimaLectura(tanque.nodoId);
    if (!ultima) return "";
    return `<article class="panel"><h3>${tanque.nombre}</h3>
      <meter min="0" max="100" low="25" high="50" optimum="100" value="${ultima.bateria}" aria-label="Batería del nodo"></meter>
      <p>${Math.round(ultima.bateria)} % · Última señal ${formatearFecha(ultima.fecha)}</p></article>`;
  }).join("");
}

// Aplica los filtros de nodo y fechas y dibuja la tabla
function filtrarLecturas(evento) {
  evento?.preventDefault();
  const { nodo, desde, hasta } = Object.fromEntries(new FormData($("filtros_lecturas")));
  if (desde && hasta && desde > hasta) return ($("error_filtros").value = "La fecha inicial no puede ser posterior a la final.");
  $("error_filtros").value = "";
  const filtradas = lecturas.filter((lectura) =>
    (!nodo || lectura.nodoId === nodo) &&
    (!desde || new Date(lectura.fecha) >= new Date(desde + "T00:00:00")) &&
    (!hasta || new Date(lectura.fecha) <= new Date(hasta + "T23:59:59")));
  renderTablaLecturas(filtradas.reverse());
}

let lecturasMostradas = [];

// Guarda y presenta las lecturas filtradas; conserva un máximo de 150 filas visibles.
function renderTablaLecturas(datos) {
  lecturasMostradas = datos;
  const celda = (lectura, variable) => `<td class="${estadoParametro(variable, lectura[variable]) === "fuera" ? "fuera" : ""}">${lectura[variable].toFixed(UMBRALES[variable].decimales)}</td>`;
  $("cuerpo_tabla_lecturas").innerHTML = datos.slice(0, 150).map((lectura) => `<tr>
    <td><time datetime="${lectura.fecha}">${formatearFecha(lectura.fecha)}</time></td><td>${nombreTanque(lectura.nodoId)}</td>
    ${celda(lectura, "ph")}${celda(lectura, "turbidez")}${celda(lectura, "conductividad")}${celda(lectura, "temperatura")}
    <td><span class="insignia" data-clase="${CLASES[lectura.clasificacion]}">${lectura.clasificacion}</span></td></tr>`).join("")
    || `<tr><td colspan="7">No se registran datos para el filtro seleccionado.</td></tr>`;
}

// Descarga como CSV las lecturas que quedaron visibles tras aplicar los filtros.
function exportarCSV() {
  const filas = lecturasMostradas.map((lectura) => [lectura.fecha, lectura.nodoId, lectura.ph.toFixed(2), lectura.turbidez.toFixed(2), lectura.conductividad.toFixed(0), lectura.temperatura.toFixed(1), lectura.clasificacion].join(","));
  const csv = ["Fecha,Nodo,pH,Turbidez (NTU),Conductividad (uS/cm),Temperatura (C),Clasificacion", ...filas].join("\n");
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  enlace.download = "lecturas.csv";
  enlace.click();
}

/* ============================ ALERTAS ============================ */

let severidadActiva = "todas";

// Actualiza el filtro de severidad seleccionado y vuelve a dibujar la lista de alertas.
function filtrarAlertas(severidad) {
  severidadActiva = severidad;
  document.querySelectorAll("#filtros_alertas button").forEach((b) => b.classList.toggle("activa", b.dataset.severidad === severidad));
  renderAlertas();
}

// Renderiza las alertas que coinciden con la severidad activa y actualiza el contador.
function renderAlertas() {
  const etiquetas = { critica: "Crítica", advertencia: "Advertencia", resuelta: "Resuelta" };
  const visibles = alertas.filter((a) => severidadActiva === "todas" || a.severidad === severidadActiva);
  $("lista_alertas").innerHTML = visibles.map((a) => `
    <article class="alerta" data-severidad="${a.severidad}" data-leida="${a.leida ? "si" : "no"}">
      <header><h3>${a.titulo}</h3><p>${a.mensaje}</p></header>
      <div><span class="insignia">${etiquetas[a.severidad]}</span> <time datetime="${a.fecha}">${formatearFecha(a.fecha)}</time></div>
      <footer>
        ${a.leida ? "" : `<button type="button" class="boton_secundario" data-accion="leer" data-id="${a.id}">Marcar como leída</button>`}
        ${a.severidad === "resuelta" ? "" : `<button type="button" class="boton_secundario" data-accion="resolver" data-id="${a.id}">Marcar como resuelta</button>`}
        <button type="button" class="boton_principal" data-accion="ver" data-id="${a.id}">Ver en dashboard</button>
      </footer>
    </article>`).join("") || "<p>No hay alertas activas en este momento.</p>";
  actualizarContadorAlertas();
}

// Procesa las acciones de una alerta: marcarla leída, resolverla o abrir su tanque en el dashboard.
function accionAlerta(evento) {
  const boton = evento.target.closest("button[data-accion]");
  if (!boton) return;
  const alerta = alertas.find((a) => a.id === boton.dataset.id);
  if (boton.dataset.accion === "leer") alerta.leida = true;
  if (boton.dataset.accion === "resolver") { alerta.severidad = "resuelta"; alerta.leida = true; }
  if (boton.dataset.accion === "ver") { $("selector_tanque").value = alerta.nodoId; actualizarDashboard(); mostrarVista("vista_dashboard"); }
  renderAlertas();   // Si usas el backend, aquí también se enviaría un PATCH a /alertas/:id
}

// Actualiza los contadores de alertas pendientes y la insignia de notificaciones.
function actualizarContadorAlertas() {
  const sinLeer = alertas.filter((a) => !a.leida && a.severidad !== "resuelta").length;
  $("contador_alertas").textContent = sinLeer;
  const insignia = $("insignia_notificaciones");
  insignia.textContent = sinLeer > 99 ? "99+" : sinLeer;
  insignia.hidden = sinLeer === 0;
  $("boton_notificaciones").setAttribute(
    "aria-label",
    sinLeer ? `Ver notificaciones, ${sinLeer} sin leer` : "Ver notificaciones, ninguna sin leer"
  );
}

/* ============================ CHAT CON LLAMA AI ============================ */

const TIEMPO_MAXIMO_CHAT_MS = 15000;

// Abre el chat y, opcionalmente, envía una pregunta inicial desde el botón de interpretación.
function abrirChat(preguntaInicial) {
  $("chat_ia").hidden = false;
  $("boton_chat").hidden = true;
  if (!$("chat_mensajes").children.length) agregarMensaje("ia", "Hola, soy el asistente de calidad del agua. Puedo explicarte la última lectura del tanque y darte recomendaciones de uso.");
  if (preguntaInicial) enviarPregunta(preguntaInicial);
  else $("chat_entrada").focus();
}

function cerrarChat() {
  $("chat_ia").hidden = true;
  $("boton_chat").hidden = false;
}

// Añade al historial un mensaje de usuario o del asistente y desplaza el chat al final.
function agregarMensaje(autor, texto) {
  const mensaje = document.createElement("li");
  mensaje.dataset.autor = autor;
  mensaje.textContent = texto;
  $("chat_mensajes").append(mensaje);
  $("chat_mensajes").scrollTop = $("chat_mensajes").scrollHeight;
}

// Solo letras, números y signos básicos de puntuación
const preguntaValida = (pregunta) => /^[\p{L}\p{N}\s¿?¡!.,:;()%/-]+$/u.test(pregunta);

// Respuesta simulada. En producción el backend arma el prompt con la lectura actual y llama a Llama AI.
function responderDemo(pregunta) {
  const ultima = ultimaLectura(nodoActual());
  const preguntaNormalizada = pregunta.toLowerCase();
  const resumen = `Última lectura: pH ${ultima.ph.toFixed(1)}, turbidez ${ultima.turbidez.toFixed(1)} NTU, conductividad ${ultima.conductividad.toFixed(0)} µS/cm. Clasificación: ${ultima.clasificacion}.`;
  const consejo = (REPORTES_DEMO[ultima.clasificacion] ?? ["", []])[1].join(". ");
  if (/beb|consum|tomar|cocin|segur|apta|interpret|lectura|diagn|recomend/.test(preguntaNormalizada)) return `${resumen}\n${REPORTES_DEMO[ultima.clasificacion][0]}\n${consejo}.`;
  if (/turbidez/.test(preguntaNormalizada)) return `La turbidez mide qué tan turbia está el agua por sedimentos. El límite de referencia es ${UMBRALES.turbidez.max} NTU y ahora está en ${ultima.turbidez.toFixed(1)} NTU. Después de lluvias suele subir.`;
  if (/conductividad/.test(preguntaNormalizada)) return `La conductividad indica la cantidad de sales disueltas. Ahora está en ${ultima.conductividad.toFixed(0)} µS/cm y el límite es ${UMBRALES.conductividad.max}.`;
  if (/ph|riego|agua|tanque|sensor|bater/.test(preguntaNormalizada)) return `${resumen}\nPara riego, estos valores son aceptables mientras la clasificación no sea "No apta".`;
  return "Soy un asistente especializado en el monitoreo del agua de tu comunidad. Hazme preguntas sobre la calidad del agua o las recomendaciones de uso.";
}

async function enviarPregunta(pregunta) {
  pregunta = pregunta.trim();
  if (!pregunta) return;
  if (!preguntaValida(pregunta)) return agregarMensaje("ia", "Escribe tu pregunta usando solo letras, números y signos de puntuación.");
  agregarMensaje("usuario", pregunta);
  $("chat_entrada").value = "";
  $("chat_estado").hidden = false;
  try {
    const consulta = CONFIG.usarDatosDemo
      ? new Promise((resolverConsulta) => setTimeout(() => resolverConsulta({ respuesta: responderDemo(pregunta) }), 700))
      : llamarApi(CONFIG.endpoints.chat, { method: "POST", body: JSON.stringify({ nodoId: nodoActual(), pregunta }) });
    const limite = new Promise((_, rechazarConsulta) => setTimeout(() => rechazarConsulta(new Error("tiempo agotado")), TIEMPO_MAXIMO_CHAT_MS));
    agregarMensaje("ia", (await Promise.race([consulta, limite])).respuesta);
  } catch {
    agregarMensaje("ia", "No fue posible conectar con el asistente de IA en este momento. Consulta las métricas y el estado en el Dashboard principal.");
  }
  $("chat_estado").hidden = true;
}

/* ============================ INICIO ============================ */

// Rellena los selectores de tanque y medición con las opciones disponibles.
function llenarSelectores() {
  const opcionesNodos = tanques.map((tanque) => `<option value="${tanque.nodoId}">${tanque.nombre}</option>`).join("");
  $("selector_tanque").innerHTML = opcionesNodos;
  $("filtro_nodo").innerHTML = `<option value="">Todos los nodos</option>${opcionesNodos}`;
  const opcionesVariables = VARIABLES.map((variable) => `<option value="${variable}">${UMBRALES[variable].nombre}</option>`).join("");
  $("variable_grafica_principal").innerHTML = opcionesVariables;
  $("variable_tendencia").innerHTML = opcionesVariables;
}

// Carga los datos iniciales y actualiza los componentes de todas las secciones.
async function iniciarAplicacion() {
  await cargarTanques();
  await cargarLecturas();
  await cargarAlertas();
  llenarSelectores();
  actualizarDashboard();
  renderEstadoNodos();
  filtrarLecturas();
  renderAlertas();
  mostrarVista("vista_dashboard");
}

// Asocia los controles del HTML con sus funciones para navegación, formularios, filtros y chat.
function conectarEventos() {
  const formularioLogin = $("form_login");
  if (formularioLogin) {
    if (sesion) {
      window.location.replace("dashboard.html");
      return;
    }
    formularioLogin.addEventListener("submit", iniciarSesion);
    return;
  }

  const formularioRegistro = $("form_registro");
  if (formularioRegistro) {
    if (sesion) {
      window.location.replace("dashboard.html");
      return;
    }
    formularioRegistro.addEventListener("submit", registrarUsuario);
    return;
  }

  if (!sesion && !$("aplicacion")) return;
  if (sesion && !$("aplicacion")) {
    window.location.replace("dashboard.html");
    return;
  }
  if (!$("aplicacion")) return;
  if (!sesion) {
    window.location.replace("login.html");
    return;
  }
  $("nombre_usuario").textContent = sesion.nombre;
  $("boton_cerrar_sesion").addEventListener("click", cerrarSesion);
  $("menu_principal").addEventListener("click", (evento) => evento.target.closest("button") && mostrarVista(evento.target.closest("button").dataset.vista));
  $("boton_notificaciones").addEventListener("click", () => mostrarVista("vista_alertas"));
  $("selector_tanque").addEventListener("change", () => { actualizarDashboard(); actualizarTendencias(); });
  $("variable_grafica_principal").addEventListener("change", dibujarGraficaPrincipal);
  $("filtros_lecturas").addEventListener("submit", filtrarLecturas);
  $("boton_exportar").addEventListener("click", exportarCSV);
  $("filtros_alertas").addEventListener("click", (evento) => evento.target.dataset.severidad && filtrarAlertas(evento.target.dataset.severidad));
  $("lista_alertas").addEventListener("click", accionAlerta);
  $("boton_chat").addEventListener("click", () => abrirChat());
  $("boton_interpretar").addEventListener("click", () => abrirChat("Interpreta la última lectura del tanque y dame recomendaciones."));
  $("boton_cerrar_chat").addEventListener("click", cerrarChat);
  $("form_chat").addEventListener("submit", (evento) => { evento.preventDefault(); enviarPregunta($("chat_entrada").value); });
  $("chat_sugerencias").addEventListener("click", (evento) => evento.target.dataset.pregunta && enviarPregunta(evento.target.dataset.pregunta));
  $("boton_menu").addEventListener("click", () => document.querySelector(".barra_lateral").classList.toggle("abierta"));
  $("filtros_tendencias").addEventListener("submit", (evento) => { evento.preventDefault(); actualizarTendencias(); });
  iniciarAplicacion();
}

conectarEventos();