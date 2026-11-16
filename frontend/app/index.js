/* =====================================================================
   WaterQualitySensors - lógica del frontend (JavaScript puro + Chart.js)

   Flujo del sistema:
   Sensores -> Cubecell -> Dragino (LoRaWAN) -> MongoDB -> Backend
   -> Random Forest (Buena | Aceptable | Riesgo | No apta)
   -> JSON -> IA (OpenRouter) -> Backend -> esta interfaz

   Para conectar con el backend: poner usarDatosDemo en false y ajustar
   apiBase y endpoints. Cada función "cargar..." indica la forma del JSON.
   ===================================================================== */

const CONFIG = {
  usarDatosDemo: false,                   // false = consumir el backend real
  apiBase: `${window.location.origin}/api`, // API del mismo gateway que sirve el frontend
  endpoints: {
    login: "/auth/login",                 // POST {email, password} -> {token, usuario:{nombre, rol}}
    registro: "/auth/registro",           // POST {usuario, nombre, email, telefono, vereda, password}
    tanques: "/tanques",                  // GET  -> [{nodoId, nombre}]
    lecturas: "/lecturas",                // GET  ?nodoId=&desde=&hasta= -> [Lectura]
    predicciones: "/predicciones",        // GET  ?nodoId=&desde=&hasta= -> [Prediccion ML]
    alertas: "/alertas",                  // GET  -> [Alerta]
    chat: "/ia/chat",                     // POST {nodoId, pregunta, historial[]} -> {respuesta}
    reporteIA: "/ia/reporte",             // GET  ?nodoId= -> {explicacion, recomendaciones[]}
    perfil: "/auth/perfil",               // GET/PUT -> datos del usuario en sesión
    reportes: "/reportes"                 // POST {nodoId, variable, mensaje}; GET solo admin
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
// Solo el administrador puede exportar CSV y gestionar los reportes de la comunidad.
const esAdmin = () => sesion?.rol === "admin";
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
  let respuesta;
  try {
    respuesta = await fetch(CONFIG.apiBase + ruta, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion?.token ?? ""}` },
      ...opciones
    });
  } catch {
    throw new Error(`No se pudo conectar con el gateway en ${window.location.origin}. Verifica que esté ejecutándose.`);
  }

  // Si el token venció, se cierra la sesión y se vuelve al login.
  if (respuesta.status === 401 && sesion?.token) {
    sesion = null;
    sessionStorage.removeItem(CLAVE_SESION);
    window.location.replace("login.html");
    throw new Error("La sesión expiró. Vuelve a iniciar sesión.");
  }

  if (!respuesta.ok) {
    let mensaje = `Error ${respuesta.status}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      // La respuesta no traía JSON; se conserva el mensaje genérico.
    }
    throw new Error(mensaje);
  }

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
  const consulta = CONFIG.usarDatosDemo ? "" : "?limite=10000";
  lecturas = CONFIG.usarDatosDemo ? generarLecturasDemo() : await llamarApi(CONFIG.endpoints.lecturas + consulta);
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
  if (idVista === "vista_reportes" && esAdmin()) cargarReportes();
  if (idVista === "vista_predicciones") actualizarPrediccionesML();
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
  if (typeof actualizarContextoChat === "function") actualizarContextoChat(ultima);
  dibujarGraficaPrincipal();
}

// Explica en una frase por qué el valor está fuera de rango o cerca del límite.
function explicacionEstado(variable, valor, estado) {
  if (estado === "ok") return "";
  const c = UMBRALES[variable];
  const fmt = (numero) => numero.toFixed(c.decimales);
  if (estado === "fuera") {
    if (c.min !== undefined && valor < c.min) return `Está por debajo del mínimo seguro (${c.min} ${c.unidad}).`;
    return `Supera el máximo permitido (${c.max} ${c.unidad}).`;
  }
  if (c.max !== undefined && valor > c.max - c.margen) return `Se acerca al límite máximo (${fmt(c.max - c.margen)} – ${fmt(c.max)} ${c.unidad}).`;
  return `Se acerca al límite mínimo (${fmt(c.min + c.margen)} – ${fmt(c.min)} ${c.unidad}).`;
}

// Construye las tarjetas de medición con su valor, unidad y estado respecto a los umbrales.
function renderTarjetasMetricas(ultima) {
  $("tarjetas_metricas").innerHTML = VARIABLES.map((variable) => {
    const configuracionVariable = UMBRALES[variable];
    const valor = ultima[variable];
    const estado = estadoParametro(variable, valor);
    const apoyo = variable === "temperatura" ? " (apoyo)" : "";
    const etiquetaEstado = { ok: "Normal", alerta: "Cerca del límite", fuera: "Fuera de rango" }[estado];
    const explicacion = explicacionEstado(variable, valor, estado);
    const botonReportar = estado !== "ok" && !esAdmin()
      ? `<button type="button" class="enlace_reportar" data-variable="${variable}"><svg class="icono" aria-hidden="true"><use href="#i_alertas"/></svg>Reportar alteración</button>`
      : "";
    return `<article class="tarjeta_metrica" data-estado="${estado}">
      <h3>${configuracionVariable.nombre}${apoyo}</h3>
      <output>${valor.toFixed(configuracionVariable.decimales)} <small>${configuracionVariable.unidad}</small></output>
      <meter min="${configuracionVariable.escala[0]}" max="${configuracionVariable.escala[1]}" low="${configuracionVariable.min ?? configuracionVariable.escala[0]}" high="${configuracionVariable.max}" optimum="${configuracionVariable.min !== undefined ? (configuracionVariable.min + configuracionVariable.max) / 2 : configuracionVariable.escala[0]}" value="${valor}"></meter>
      <p class="badge_estado" data-clase="${estado === "ok" ? "buena" : estado === "alerta" ? "riesgo" : "no_apta"}">${etiquetaEstado}</p>
      ${explicacion ? `<p class="explicacion_estado">${explicacion}</p>` : ""}
      <small>${descripcionRango(configuracionVariable)}</small>
      ${botonReportar}
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
  const bloque = $("ia_bloque_recomendaciones");
  const lista = $("ia_recomendaciones");
  try {
    const reporte = await cargarReporteIA(ultima.nodoId, ultima);
    $("ia_explicacion").textContent = reporte.explicacion;

    const recomendaciones = Array.isArray(reporte.recomendaciones) ? reporte.recomendaciones.filter(Boolean) : [];
    lista.replaceChildren(...recomendaciones.map((recomendacion) => {
      const elemento = document.createElement("li");
      elemento.textContent = recomendacion;
      return elemento;
    }));
    bloque.hidden = recomendaciones.length === 0;
    $("ia_origen").textContent = `Basado en pH ${ultima.ph.toFixed(1)} y turbidez ${ultima.turbidez.toFixed(1)} NTU.`;
  } catch {
    // Mensaje de contingencia si la IA no responde
    $("ia_explicacion").textContent = "Explicación temporalmente no disponible. Guíate por la categoría de calidad y los valores del Dashboard.";
    lista.replaceChildren();
    bloque.hidden = true;
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

// Carga las predicciones del modelo Random Forest para el periodo y nodo elegidos.
// En modo real provienen de la colección "predicciones" del backend; en demo se derivan de las lecturas simuladas.
async function cargarPredicciones({ horas, nodoId } = {}) {
  const desde = new Date(Date.now() - horas * 3600000).toISOString();
  if (CONFIG.usarDatosDemo) {
    return lecturas
      .filter((lectura) => (!nodoId || lectura.nodoId === nodoId) && new Date(lectura.fecha) >= new Date(desde))
      .map((lectura) => ({
        nodoId: lectura.nodoId,
        fecha: lectura.fecha,
        clase: lectura.clasificacion,
        confianza: null,
        modelo: "random_forest",
        entradas: { ph: lectura.ph, turbidez: lectura.turbidez, conductividad: lectura.conductividad, temperatura: lectura.temperatura }
      }));
  }
  const parametros = new URLSearchParams({ desde, limite: "5000" });
  if (nodoId) parametros.set("nodoId", nodoId);
  return llamarApi(`${CONFIG.endpoints.predicciones}?${parametros}`);
}

// Muestra solo la salida del modelo Random Forest filtrada por periodo y nodo:
// la clase predicha más reciente por tanque y la distribución dentro del periodo.
async function actualizarPrediccionesML() {
  const contenedor = $("predicciones_ml");
  if (!contenedor) return;
  const horas = Number($("filtro_periodo_ml")?.value) || 168;
  const nodoId = $("filtro_nodo_ml")?.value || "";
  contenedor.innerHTML = `<p class="nota_vista">Consultando predicciones del modelo…</p>`;
  try {
    const predicciones = await cargarPredicciones({ horas, nodoId });
    if (!predicciones.length) {
      contenedor.innerHTML = `<p class="nota_vista">No hay predicciones registradas para el periodo seleccionado.</p>`;
      return;
    }
    const ids = nodoId ? [nodoId] : [...new Set(predicciones.map((prediccion) => prediccion.nodoId))];
    const clases = ["Buena", "Aceptable", "Riesgo", "No apta"];
    contenedor.innerHTML = ids.map((id) => {
      const delNodo = predicciones.filter((prediccion) => prediccion.nodoId === id);
      const ultima = delNodo.at(-1);
      if (!ultima) return "";
      const total = Math.max(delNodo.length, 1);
      const entradas = ultima.entradas || {};
      const valores = entradas.ph !== undefined && entradas.ph !== null
        ? `pH ${Number(entradas.ph).toFixed(1)} · Turbidez ${Number(entradas.turbidez).toFixed(1)} NTU · Conductividad ${Number(entradas.conductividad).toFixed(0)} µS/cm`
        : "Entradas no disponibles";
      const distribucion = clases.map((clase) => {
        const cantidad = delNodo.filter((prediccion) => prediccion.clase === clase).length;
        const porcentaje = Math.round((cantidad / total) * 100);
        return `<div class="prediccion_barra">
          <span>${clase}</span>
          <span class="prediccion_pista"><span class="prediccion_relleno" data-clase="${CLASES[clase]}" style="width:${porcentaje}%"></span></span>
          <span>${porcentaje}%</span>
        </div>`;
      }).join("");
      const confianza = ultima.confianza !== null && ultima.confianza !== undefined
        ? ` · confianza ${Math.round(ultima.confianza * 100)}%` : "";
      return `<article class="panel prediccion_card">
        <header class="prediccion_encabezado">
          <h3>${nombreTanque(id)}</h3>
          <span class="insignia" data-clase="${CLASES[ultima.clase] || "riesgo"}">${ultima.clase}</span>
        </header>
        <p class="prediccion_valores">${valores}</p>
        <small>Modelo ${ultima.modelo || "random_forest"}${confianza} · ${formatearFecha(ultima.fecha)} · ${delNodo.length} predicciones en el periodo</small>
        <div class="prediccion_distribucion">
          <p class="prediccion_distribucion_titulo">Distribución en el periodo</p>
          ${distribucion}
        </div>
      </article>`;
    }).join("") || `<p class="nota_vista">No hay predicciones registradas para el periodo seleccionado.</p>`;
  } catch (error) {
    contenedor.innerHTML = `<p class="nota_vista mensaje_error">${error.message}</p>`;
  }
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

// Periodos rápidos del filtro de lecturas (en horas).
const PERIODOS_LECTURAS = { "24h": 24, "7d": 168, "30d": 720, "365d": 8760 };

// Aplica los filtros de periodo, nodo y fechas personalizadas, y dibuja la tabla.
function filtrarLecturas(evento) {
  evento?.preventDefault();
  const { nodo } = Object.fromEntries(new FormData($("filtros_lecturas")));
  const periodo = $("filtro_periodo").value;

  if (periodo === "personalizado") {
    const desde = $("filtro_desde").value;
    const hasta = $("filtro_hasta").value;
    if (desde && hasta && desde > hasta) return ($("error_filtros").value = "La fecha inicial no puede ser posterior a la final.");
    $("error_filtros").value = "";
    const filtradas = lecturas.filter((lectura) =>
      (!nodo || lectura.nodoId === nodo) &&
      (!desde || new Date(lectura.fecha) >= new Date(desde + "T00:00:00")) &&
      (!hasta || new Date(lectura.fecha) <= new Date(hasta + "T23:59:59")));
    renderTablaLecturas(filtradas.reverse());
    return;
  }

  $("error_filtros").value = "";
  const desdeMs = Date.now() - PERIODOS_LECTURAS[periodo] * 3600000;
  const filtradas = lecturas.filter((lectura) =>
    (!nodo || lectura.nodoId === nodo) && new Date(lectura.fecha) >= desdeMs);
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

/* ============================ NOTIFICACIONES ============================ */

// Alterna el panel desplegable de notificaciones bajo el botón de la campana.
function alternarNotificaciones() {
  const panel = $("panel_notificaciones");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderNotificaciones();
}

function cerrarNotificaciones() {
  const panel = $("panel_notificaciones");
  if (panel) panel.hidden = true;
}

// Dibuja las alertas más recientes dentro del panel desplegable.
function renderNotificaciones() {
  const lista = $("lista_notificaciones");
  if (!lista) return;
  const recientes = [...alertas]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 8);

  lista.innerHTML = recientes.map((a) => `
    <li>
      <button type="button" class="notificacion_item" data-id="${a.id}">
        <span class="punto_severidad" data-severidad="${a.severidad}"></span>
        <span class="notificacion_texto">
          <strong>${a.titulo}</strong>
          <small>${a.mensaje} · ${formatearFecha(a.fecha)}</small>
        </span>
      </button>
    </li>`).join("") || `<li class="notificacion_vacia">No hay notificaciones por ahora.</li>`;
}

// Procesa el clic dentro del panel: abre la alerta en el dashboard o la marca como leída.
function accionNotificacion(evento) {
  const boton = evento.target.closest("button[data-id]");
  if (!boton) return;
  const alerta = alertas.find((a) => a.id === boton.dataset.id);
  if (!alerta) return;
  cerrarNotificaciones();
  if (boton.dataset.accion !== "leer") {
    alerta.leida = true;
    renderAlertas();
  }
  if (boton.dataset.accion === "ver" || !boton.dataset.accion) {
    $("selector_tanque").value = alerta.nodoId;
    actualizarDashboard();
    mostrarVista("vista_dashboard");
  }
}

function marcarTodasLeidas() {
  alertas.forEach((a) => { a.leida = true; });
  renderAlertas();
  renderNotificaciones();
}

/* ============================ REPORTES DE LA COMUNIDAD ============================ */

const ETIQUETAS_REPORTE = { pendiente: "Pendiente", en_revision: "En revisión", resuelto: "Resuelto" };

// Solo el administrador consulta los reportes enviados por los usuarios.
async function cargarReportes() {
  const lista = $("lista_reportes");
  if (!lista) return;
  try {
    const reportes = await llamarApi(CONFIG.endpoints.reportes);
    $("contador_reportes").textContent = reportes.filter((r) => r.estado !== "resuelto").length;
    lista.innerHTML = reportes.map((r) => `
      <article class="alerta reporte_item" data-estado="${r.estado}">
        <header>
          <h3>${UMBRALES[r.variable]?.nombre || r.variable || "Observación general"} · ${r.nodoId ? nombreTanque(r.nodoId) : "Todos los tanques"}</h3>
          <p>${r.mensaje}</p>
        </header>
        <div>
          <span class="insignia">${ETIQUETAS_REPORTE[r.estado] || r.estado}</span>
          <small>${r.usuario}${r.email ? ` · ${r.email}` : ""}</small>
          <time datetime="${r.creadoEn}">${formatearFecha(r.creadoEn)}</time>
        </div>
        <footer>
          <label class="estado_reporte_label" for="estado_${r.id}">Estado</label>
          <select class="estado_reporte" id="estado_${r.id}" data-id="${r.id}">
            ${Object.entries(ETIQUETAS_REPORTE).map(([valor, texto]) => `<option value="${valor}" ${r.estado === valor ? "selected" : ""}>${texto}</option>`).join("")}
          </select>
        </footer>
      </article>`).join("") || "<p>No hay reportes de la comunidad todavía.</p>";
  } catch (error) {
    lista.innerHTML = `<p>${error.message}</p>`;
  }
}

// Cambia el estado de un reporte desde el selector de la vista de administración.
async function cambiarEstadoReporte(evento) {
  const selector = evento.target.closest(".estado_reporte");
  if (!selector) return;
  try {
    await llamarApi(`${CONFIG.endpoints.reportes}/${selector.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: selector.value })
    });
    cargarReportes();
  } catch (error) {
    alert(error.message || "No se pudo actualizar el reporte.");
  }
}

/* ============================ REPORTAR ALTERACIÓN (USUARIO) ============================ */

// Abre el modal para que el usuario envíe una nota al administrador sobre un parámetro alterado.
function abrirReporte(variable) {
  const modal = $("modal_reporte");
  if (!modal) return;
  const selector = $("reporte_variable");
  if (!selector.options.length) {
    selector.innerHTML = VARIABLES.map((v) => `<option value="${v}">${UMBRALES[v].nombre}</option>`).join("");
  }
  selector.value = variable;
  $("reporte_mensaje").value = "";
  $("error_reporte").value = "";
  $("ok_reporte").value = "";
  modal.hidden = false;
  $("reporte_mensaje").focus();
}

function cerrarReporte() {
  $("modal_reporte").hidden = true;
}

async function enviarReporte(evento) {
  evento.preventDefault();
  const mensaje = $("reporte_mensaje").value.trim();
  if (mensaje.length < 5) return ($("error_reporte").value = "Describe brevemente lo que observaste (mínimo 5 caracteres).");
  $("error_reporte").value = "";
  try {
    await llamarApi(CONFIG.endpoints.reportes, {
      method: "POST",
      body: JSON.stringify({
        nodoId: nodoActual(),
        variable: $("reporte_variable").value,
        mensaje
      })
    });
    $("ok_reporte").value = "Reporte enviado. El administrador lo revisará pronto.";
    setTimeout(cerrarReporte, 1600);
  } catch (error) {
    $("error_reporte").value = error.message || "No se pudo enviar el reporte.";
  }
}

/* ============================ ESTADO PÚBLICO (INDEX) ============================ */

const CLASES_PUBLICAS = { Buena: "buena", Aceptable: "aceptable", Riesgo: "riesgo", "No apta": "no_apta" };
let estadoPublicoActual = null;
let graficaPublica = null;

// Enlaces con data-destino apuntan al dashboard/chat si hay sesión, o al login si no.
function aplicarDestinoEnlaces() {
  const paginas = { dashboard: "dashboard.html", chat: "chat.html", perfil: "perfil.html" };
  document.querySelectorAll("[data-destino]").forEach((enlace) => {
    enlace.setAttribute("href", (sesion && paginas[enlace.dataset.destino]) || "login.html");
  });
}

function resumenEstadoPublico(tanques) {
  if (!tanques.length) return "Aún no hay tanques registrados en el sistema.";
  const buenas = tanques.filter((t) => t.clasificacion === "Buena" || t.clasificacion === "Aceptable").length;
  const conDatos = tanques.filter((t) => t.fecha).length;
  return conDatos
    ? `${buenas} de ${tanques.length} tanques en buen estado · ${conDatos} reportando datos.`
    : "Los sensores aún no han enviado lecturas.";
}

// Tarjeta pública por tanque: clasificación de color y último valor de cada parámetro.
function renderTarjetasPublicas(tanques) {
  $("tarjetas_publicas").innerHTML = tanques.map((tanque) => {
    const clase = CLASES_PUBLICAS[tanque.clasificacion] || "";
    const parametros = VARIABLES.map((variable) => {
      const valor = tanque[variable];
      return `<div><dt>${UMBRALES[variable].nombre}</dt><dd>${valor === null || valor === undefined ? "—" : valor.toFixed(UMBRALES[variable].decimales)}</dd></div>`;
    }).join("");
    return `<article class="tarjeta_publica" data-clase="${clase}">
      <header class="tarjeta_publica_encabezado">
        <h3>${tanque.nombre}</h3>
        <span class="badge_estado" data-clase="${clase}">${tanque.clasificacion}</span>
      </header>
      <dl class="datos_publicas">${parametros}</dl>
      <small>Última lectura: ${tanque.fecha ? formatearFecha(tanque.fecha) : "sin datos"}</small>
    </article>`;
  }).join("") || `<article class="tarjeta_publica tarjeta_publica_cargando"><p>No hay tanques registrados.</p></article>`;
}

// Gráfica de tendencia general (promedio de todos los tanques) para la variable elegida.
function dibujarGraficaPublica() {
  const canvas = $("grafica_publica");
  if (!canvas || typeof Chart === "undefined" || !estadoPublicoActual) return;
  const variable = $("variable_publica")?.value || "ph";
  const serie = estadoPublicoActual.tendencia?.[variable] || [];
  const etiquetas = serie.map((punto) =>
    new Date(punto.t).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit" }));

  graficaPublica?.destroy();
  graficaPublica = new Chart(canvas, {
    type: "line",
    data: {
      labels: etiquetas,
      datasets: [{
        data: serie.map((punto) => punto.v),
        borderColor: "#1d6fd1",
        backgroundColor: "rgba(29,111,209,.1)",
        fill: true,
        tension: .3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: "#47617e" }, grid: { color: "rgba(13,58,102,.08)" } },
        y: { ticks: { color: "#47617e" }, grid: { color: "rgba(13,58,102,.08)" } }
      }
    }
  });
}

// Tilt 3D sutil que sigue el puntero en las tarjetas de la página de inicio.
function iniciarTilt3D() {
  document.querySelectorAll(".tarjeta_publica, .tarjeta_flotante").forEach((tarjeta) => {
    tarjeta.addEventListener("pointermove", (evento) => {
      const caja = tarjeta.getBoundingClientRect();
      const x = (evento.clientX - caja.left) / caja.width - 0.5;
      const y = (evento.clientY - caja.top) / caja.height - 0.5;
      tarjeta.style.transform = `perspective(800px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
    });
    tarjeta.addEventListener("pointerleave", () => { tarjeta.style.transform = ""; });
  });
}

// Carga el estado público del agua para la página de inicio (no requiere sesión).
async function iniciarEstadoPublico() {
  const contenedor = $("tarjetas_publicas");
  if (!contenedor) return;
  try {
    const respuesta = await fetch(`${CONFIG.apiBase}/publico/estado`);
    if (!respuesta.ok) throw new Error("Sin datos");
    estadoPublicoActual = await respuesta.json();
    renderTarjetasPublicas(estadoPublicoActual.tanques || []);
    dibujarGraficaPublica();
    $("estado_publico_resumen").textContent = resumenEstadoPublico(estadoPublicoActual.tanques || []);
    $("variable_publica")?.addEventListener("change", dibujarGraficaPublica);
    iniciarTilt3D();
  } catch {
    contenedor.innerHTML = `<article class="tarjeta_publica tarjeta_publica_cargando"><p>No se pudo consultar el estado del agua. Intenta de nuevo más tarde.</p></article>`;
    $("estado_publico_resumen").textContent = "Servicio no disponible";
  }
}

/* ============================ INICIO ============================ */

// Rellena los selectores de tanque y medición con las opciones disponibles.
function llenarSelectores() {
  const opcionesNodos = tanques.map((tanque) => `<option value="${tanque.nodoId}">${tanque.nombre}</option>`).join("");
  $("selector_tanque").innerHTML = opcionesNodos;
  $("filtro_nodo").innerHTML = `<option value="">Todos los nodos</option>${opcionesNodos}`;
  $("filtro_nodo_ml") && ($("filtro_nodo_ml").innerHTML = `<option value="">Todos los nodos</option>${opcionesNodos}`);
  const opcionesVariables = VARIABLES.map((variable) => `<option value="${variable}">${UMBRALES[variable].nombre}</option>`).join("");
  $("variable_grafica_principal").innerHTML = opcionesVariables;
  $("variable_tendencia").innerHTML = opcionesVariables;
}

// Carga los datos iniciales y actualiza los componentes de todas las secciones.
async function iniciarAplicacion() {
  try {
    await cargarTanques();
    await cargarLecturas();
    await cargarAlertas();
    llenarSelectores();
    actualizarDashboard();
    renderEstadoNodos();
    filtrarLecturas();
    renderAlertas();
    mostrarVista("vista_dashboard");
  } catch (error) {
    console.error("No se pudo cargar la aplicación:", error);
    $("fecha_ultima_lectura").textContent = "Sin conexión";
    $("clasificacion_general").textContent = "Error de conexión";
    $("clasificacion_general").dataset.clase = "no_apta";
    $("ia_explicacion").textContent = error.message;
    $("ia_recomendaciones").replaceChildren();
    $("ia_bloque_recomendaciones").hidden = true;
    $("ia_origen").textContent = "";
  }
}

// Asocia los controles del dashboard con sus funciones de navegación y filtros.
function conectarEventos() {
  if (!$("aplicacion")) return;
  if (!sesion) {
    window.location.replace("login.html");
    return;
  }
  $("nombre_usuario").textContent = sesion.nombre;
  $("nombre_usuario_perfil")?.setAttribute("title", sesion.email || "");

  // Restricciones por rol: el comunero no exporta CSV ni gestiona reportes.
  if (esAdmin()) {
    if ($("menu_reportes")) $("menu_reportes").hidden = false;
  } else {
    if ($("boton_exportar")) $("boton_exportar").hidden = true;
    if ($("menu_reportes")) $("menu_reportes").hidden = true;
  }

  $("boton_cerrar_sesion").addEventListener("click", cerrarSesion);
  $("menu_principal").addEventListener("click", (evento) => evento.target.closest("button") && mostrarVista(evento.target.closest("button").dataset.vista));
  $("boton_notificaciones")?.addEventListener("click", (evento) => { evento.stopPropagation(); alternarNotificaciones(); });
  $("lista_notificaciones")?.addEventListener("click", accionNotificacion);
  $("boton_marcar_todas")?.addEventListener("click", marcarTodasLeidas);
  $("ver_todas_notificaciones")?.addEventListener("click", cerrarNotificaciones);
  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".notificaciones")) cerrarNotificaciones();
  });
  document.addEventListener("keydown", (evento) => { if (evento.key === "Escape") cerrarNotificaciones(); });

  $("selector_tanque").addEventListener("change", () => { actualizarDashboard(); actualizarTendencias(); });
  $("variable_grafica_principal").addEventListener("change", dibujarGraficaPrincipal);
  $("filtro_periodo")?.addEventListener("change", () => {
    $("grupo_fechas").hidden = $("filtro_periodo").value !== "personalizado";
    filtrarLecturas();
  });
  $("filtros_lecturas").addEventListener("submit", filtrarLecturas);
  $("boton_exportar")?.addEventListener("click", exportarCSV);
  $("filtros_alertas").addEventListener("click", (evento) => evento.target.dataset.severidad && filtrarAlertas(evento.target.dataset.severidad));
  $("lista_alertas").addEventListener("click", accionAlerta);
  $("lista_reportes")?.addEventListener("change", cambiarEstadoReporte);
  $("tarjetas_metricas")?.addEventListener("click", (evento) => {
    const boton = evento.target.closest(".enlace_reportar");
    if (boton) abrirReporte(boton.dataset.variable);
  });
  $("modal_reporte_cerrar")?.addEventListener("click", cerrarReporte);
  $("modal_reporte")?.addEventListener("click", (evento) => { if (evento.target === evento.currentTarget) cerrarReporte(); });
  $("form_reporte")?.addEventListener("submit", enviarReporte);
  $("boton_menu").addEventListener("click", () => document.querySelector(".barra_lateral").classList.toggle("abierta"));
  $("filtros_tendencias").addEventListener("submit", (evento) => { evento.preventDefault(); actualizarTendencias(); });
  $("filtros_predicciones")?.addEventListener("submit", (evento) => { evento.preventDefault(); actualizarPrediccionesML(); });
  iniciarAplicacion();
}

// Arranque según la página: dashboard requiere sesión, login/registro redirigen si ya hay sesión,
// chat y perfil requieren sesión, e index muestra el estado público del agua.
const paginaActual = () => location.pathname.split("/").pop() || "index.html";

if ($("aplicacion")) {
  conectarEventos();
} else if (["login.html", "registro.html"].includes(paginaActual()) && sesion) {
  window.location.replace("dashboard.html");
} else if (["chat.html", "perfil.html"].includes(paginaActual()) && !sesion) {
  window.location.replace("login.html");
} else if (paginaActual() === "index.html") {
  aplicarDestinoEnlaces();
  iniciarEstadoPublico();
}
