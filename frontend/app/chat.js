const TIEMPO_MAXIMO_CHAT_MS = 25000;

const MENSAJE_BIENVENIDA = "Hola, soy HelioWater, tu asistente de calidad del agua. Te ayudo a entender la última lectura del tanque y a decidir si el agua es segura para beber, cocinar o regar. ¿Qué te gustaría saber?";
const MENSAJE_ERROR = "No pude conectar con el servicio de análisis en este momento. Mientras tanto, puedes revisar la categoría de calidad y los valores del Dashboard. Si el problema continúa, avisa al administrador del sistema.";
const MENSAJE_INVALIDO = "Tu pregunta contiene caracteres que no puedo procesar. Escríbela usando solo letras, números y signos de puntuación.";

let chatEnviando = false;

// Devuelve la hora actual en formato corto para la marca de tiempo del mensaje.
function horaChat() {
  return new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// Agrega texto al mensaje respetando saltos de línea y viñetas sin usar innerHTML.
function agregarTextoFormateado(contenedor, texto) {
  const lineas = String(texto ?? "").replace(/\r/g, "").split("\n");
  let lista = null;

  const agregarEnLinea = (nodo, cadena) => {
    // Convierte **negrita** en <strong> y limpia marcas de Markdown sueltas.
    cadena.split(/\*\*(.+?)\*\*/g).forEach((parte, indice) => {
      if (!parte) return;
      if (indice % 2) nodo.append(Object.assign(document.createElement("strong"), { textContent: parte }));
      else nodo.append(document.createTextNode(parte.replace(/[*_`#]/g, "")));
    });
  };

  const cerrarLista = () => { lista = null; };

  for (const lineaOriginal of lineas) {
    const linea = lineaOriginal.trim();
    if (!linea) { cerrarLista(); continue; }

    const vineta = linea.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (vineta) {
      if (!lista) {
        lista = document.createElement("ul");
        contenedor.append(lista);
      }
      const elemento = document.createElement("li");
      agregarEnLinea(elemento, vineta[1]);
      lista.append(elemento);
      continue;
    }

    cerrarLista();
    const parrafo = document.createElement("p");
    agregarEnLinea(parrafo, linea);
    contenedor.append(parrafo);
  }
}

// Añade al historial un mensaje del usuario o de HelioWater con el formato visual del chat.
function agregarMensaje(autor, texto) {
  const esIA = autor === "ia";
  const mensaje = document.createElement("li");
  mensaje.dataset.autor = autor;

  if (esIA) {
    const avatar = document.createElement("span");
    avatar.className = "chat_avatar_mini";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = '<svg class="icono"><use href="#i_logo"/></svg>';
    mensaje.append(avatar);
  }

  const burbuja = document.createElement("div");
  burbuja.className = "chat_burbuja";

  const meta = document.createElement("div");
  meta.className = "chat_meta";
  const autorTexto = document.createElement("strong");
  autorTexto.textContent = esIA ? "HelioWater" : "Tú";
  const hora = document.createElement("time");
  hora.dateTime = new Date().toISOString();
  hora.textContent = horaChat();
  meta.append(autorTexto, hora);

  const cuerpo = document.createElement("div");
  cuerpo.className = "chat_texto";
  agregarTextoFormateado(cuerpo, texto);

  burbuja.append(meta, cuerpo);

  if (esIA) {
    const copiar = document.createElement("button");
    copiar.type = "button";
    copiar.className = "chat_copiar";
    copiar.innerHTML = '<svg class="icono" aria-hidden="true"><use href="#i_copiar"/></svg> Copiar';
    copiar.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(texto);
        copiar.lastChild.textContent = " Copiado";
        setTimeout(() => { copiar.lastChild.textContent = " Copiar"; }, 1800);
      } catch {
        copiar.lastChild.textContent = " No se pudo copiar";
        setTimeout(() => { copiar.lastChild.textContent = " Copiar"; }, 1800);
      }
    });
    burbuja.append(copiar);
  }

  mensaje.append(burbuja);
  $("chat_mensajes").append(mensaje);
  $("chat_mensajes").scrollTop = $("chat_mensajes").scrollHeight;
  return mensaje;
}

// Actualiza el texto de contexto del encabezado con el tanque y la clasificación vigente.
function actualizarContextoChat(ultima) {
  if (!$("chat_contexto_texto") || !ultima) return;
  const tanque = typeof nombreTanque === "function" ? nombreTanque(ultima.nodoId) : ultima.nodoId;
  $("chat_contexto_texto").textContent = `En línea · ${tanque} · Calidad ${ultima.clasificacion.toLowerCase()}`;
}

// Limpia el historial y comienza una conversación nueva con el saludo inicial.
function nuevaConversacion() {
  $("chat_mensajes").replaceChildren();
  agregarMensaje("ia", MENSAJE_BIENVENIDA);
  $("chat_entrada").value = "";
  actualizarContadorChat();
  $("chat_estado").hidden = true;
  $("chat_entrada").focus();
}

// Abre el chat y, opcionalmente, envía una pregunta inicial desde el panel de interpretación.
function abrirChat(preguntaInicial) {
  $("chat_ia").hidden = false;
  $("boton_chat").hidden = true;
  if (!$("chat_mensajes").children.length) agregarMensaje("ia", MENSAJE_BIENVENIDA);
  if (preguntaInicial) enviarPregunta(preguntaInicial);
  else $("chat_entrada").focus();
}

function cerrarChat() {
  $("chat_ia").hidden = true;
  $("boton_chat").hidden = false;
  $("boton_chat").focus();
}

// Solo letras, números y signos básicos de puntuación
const preguntaValida = (pregunta) => /^[\p{L}\p{N}\s¿?¡!.,:;()%/-]+$/u.test(pregunta);

// Respuesta simulada. En producción el backend consulta la IA con la lectura y los registros recientes.
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

// Actualiza el contador de caracteres del compositor.
function actualizarContadorChat() {
  const entrada = $("chat_entrada");
  if (entrada && $("chat_contador")) $("chat_contador").textContent = `${entrada.value.length}/300`;
}

// Bloquea el envío mientras se espera la respuesta para evitar consultas duplicadas.
function establecerEstadoEnvio(activo) {
  chatEnviando = activo;
  $("chat_estado").hidden = !activo;
  $("boton_enviar_chat").disabled = activo;
  $("chat_entrada").setAttribute("aria-busy", activo ? "true" : "false");
  if (!activo) $("chat_mensajes").scrollTop = $("chat_mensajes").scrollHeight;
}

async function enviarPregunta(pregunta) {
  if (chatEnviando) return;
  pregunta = pregunta.trim();
  if (!pregunta) return;
  if (!preguntaValida(pregunta)) return agregarMensaje("ia", MENSAJE_INVALIDO);

  agregarMensaje("usuario", pregunta);
  $("chat_entrada").value = "";
  actualizarContadorChat();
  establecerEstadoEnvio(true);

  try {
    const consulta = CONFIG.usarDatosDemo
      ? new Promise((resolverConsulta) => setTimeout(() => resolverConsulta({ respuesta: responderDemo(pregunta) }), 700))
      : llamarApi(CONFIG.endpoints.chat, { method: "POST", body: JSON.stringify({ nodoId: nodoActual(), pregunta }) });
    const limite = new Promise((_, rechazarConsulta) => setTimeout(() => rechazarConsulta(new Error("tiempo agotado")), TIEMPO_MAXIMO_CHAT_MS));
    agregarMensaje("ia", (await Promise.race([consulta, limite])).respuesta);
  } catch {
    agregarMensaje("ia", MENSAJE_ERROR);
  } finally {
    establecerEstadoEnvio(false);
    $("chat_entrada").focus();
  }
}

function conectarChat() {
  if (!$("boton_chat")) return;
  $("boton_chat").addEventListener("click", () => abrirChat());
  $("boton_interpretar").addEventListener("click", () => abrirChat("Interpreta la última lectura del tanque y dame recomendaciones."));
  $("boton_cerrar_chat").addEventListener("click", cerrarChat);
  $("boton_nueva_conversacion").addEventListener("click", nuevaConversacion);
  $("form_chat").addEventListener("submit", (evento) => { evento.preventDefault(); enviarPregunta($("chat_entrada").value); });
  $("chat_entrada").addEventListener("input", actualizarContadorChat);
  $("chat_sugerencias").addEventListener("click", (evento) => {
    const boton = evento.target.closest("button[data-pregunta]");
    if (boton) enviarPregunta(boton.dataset.pregunta);
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !$("chat_ia").hidden) cerrarChat();
  });
  actualizarContadorChat();
}

conectarChat();
