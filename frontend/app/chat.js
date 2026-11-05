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

function conectarChat() {
  if (!$("boton_chat")) return;
  $("boton_chat").addEventListener("click", () => abrirChat());
  $("boton_interpretar").addEventListener("click", () => abrirChat("Interpreta la última lectura del tanque y dame recomendaciones."));
  $("boton_cerrar_chat").addEventListener("click", cerrarChat);
  $("form_chat").addEventListener("submit", (evento) => { evento.preventDefault(); enviarPregunta($("chat_entrada").value); });
  $("chat_sugerencias").addEventListener("click", (evento) => evento.target.dataset.pregunta && enviarPregunta(evento.target.dataset.pregunta));
}

conectarChat();
