import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UMBRALES, estadoParametro } from './calidad.js';

const directorio = path.dirname(fileURLToPath(import.meta.url));
const RUTA_PROMPT = path.join(directorio, '..', 'prompts', 'asistente_agua.md');

const PROMPT_RESPALDO = `Eres HelioWater, el asistente de calidad del agua de WaterMLdetect. Responde en español, con un tono amable, claro y cercano para una comunidad rural. Usa únicamente los datos del contexto, explica los términos técnicos con palabras sencillas, varía la redacción en cada respuesta y no inventes valores. Si hay riesgo para la salud, sé directo y da recomendaciones concretas.`;

// El prompt vive en un .md para poder ajustarlo sin tocar el código.
function cargarPrompt() {
    try {
        const contenido = fs.readFileSync(RUTA_PROMPT, 'utf8').trim();
        return contenido || PROMPT_RESPALDO;
    } catch {
        return PROMPT_RESPALDO;
    }
}

const PROMPT = cargarPrompt();

const ESTILOS = [
    'abre con una observación de campo breve y luego explica los valores',
    'empieza por la conclusión y después justifícala con los datos',
    'usa una comparación cotidiana para explicar lo que muestra la serie',
    'responde como una nota breve de bitácora comunitaria',
    'destaca primero el hallazgo más llamativo y luego da el contexto',
    'habla en segunda persona, como si acompañaras al líder comunitario',
    'cierra con una recomendación concreta y fácil de recordar'
];

const ANGULOS = [
    'enfócate en la evolución de las últimas 24 horas',
    'menciona si el comportamiento parece asociado a lluvias o sedimentos',
    'compara la última lectura con el promedio de la serie consultada',
    'señala qué parámetro conviene vigilar en la próxima lectura',
    'explica qué significa el resultado para el consumo y para el riego',
    'resalta la diferencia entre un valor puntual y una tendencia'
];

function aleatorio(lista) {
    return lista[Math.floor(Math.random() * lista.length)];
}

function instruccionDeEstilo() {
    return `Para esta respuesta, ${aleatorio(ESTILOS)}. Además, ${aleatorio(ANGULOS)}.`;
}

const REPORTES = {
    'Buena': {
        explicacion: 'El agua del tanque está dentro de los límites recomendados para consumo habitual.',
        recomendaciones: ['Mantén la tapa del tanque cerrada', 'Realiza la limpieza programada del tanque']
    },
    'Aceptable': {
        explicacion: 'Algunos valores se acercan a los límites, pero el agua todavía está en un rango tolerable.',
        recomendaciones: ['Revisa el tanque en los próximos días', 'Si es para beber, se recomienda hervirla']
    },
    'Riesgo': {
        explicacion: 'Un parámetro está fuera del rango seguro, probablemente por arrastre de sedimentos después de lluvias.',
        recomendaciones: ['Hierve el agua al menos 5 minutos antes de beberla', 'Avisa al líder de la comunidad']
    },
    'No apta': {
        explicacion: 'Varios parámetros están alterados. El agua no es segura para el consumo.',
        recomendaciones: ['No consumas esta agua', 'Usa una fuente alternativa y reporta al administrador local']
    }
};

function describirLectura(lectura) {
    return ['ph', 'turbidez', 'conductividad', 'temperatura']
        .map((variable) => {
            const configuracion = UMBRALES[variable];
            const estado = estadoParametro(variable, lectura[variable]);
            const etiqueta = estado === 'fuera' ? 'fuera de rango' : estado === 'alerta' ? 'cerca del límite' : 'normal';
            return `${configuracion.nombre}: ${lectura[variable].toFixed(configuracion.decimales)} ${configuracion.unidad} (${etiqueta})`;
        })
        .join('; ');
}

function generarReporteLocal(lectura) {
    if (!lectura) {
        return {
            explicacion: 'Todavía no hay lecturas registradas para este tanque. Verifica que el sensor esté enviando datos.',
            recomendaciones: ['Revisa la conexión del nodo y la red LoRaWAN', 'Confirma que el gateway esté recibiendo mensajes MQTT']
        };
    }

    const reporte = REPORTES[lectura.clasificacion] || REPORTES['Aceptable'];

    return {
        explicacion: `${reporte.explicacion} Lectura actual: ${describirLectura(lectura)}.`,
        recomendaciones: reporte.recomendaciones,
        clasificacion: lectura.clasificacion,
        fecha: lectura.fecha
    };
}

function responderConReglas(lectura, pregunta) {
    if (!lectura) {
        return 'Todavía no hay lecturas registradas para este tanque. Cuando el sensor envíe datos podré interpretarlos.';
    }

    const texto = pregunta.toLowerCase();
    const resumen = `Última lectura: pH ${lectura.ph.toFixed(2)}, turbidez ${lectura.turbidez.toFixed(2)} NTU, conductividad ${lectura.conductividad.toFixed(0)} µS/cm y temperatura ${lectura.temperatura.toFixed(1)} °C. Clasificación: ${lectura.clasificacion}.`;
    const reporte = REPORTES[lectura.clasificacion] || REPORTES['Aceptable'];

    if (/beb|consum|tomar|cocin|segur|apta|interpret|lectura|diagn|recomend/.test(texto)) {
        return `${resumen}\n${reporte.explicacion}\n${reporte.recomendaciones.join('. ')}.`;
    }
    if (/turbidez/.test(texto)) {
        return `La turbidez mide los sedimentos que enturbian el agua. El límite de referencia es ${UMBRALES.turbidez.max} NTU y ahora está en ${lectura.turbidez.toFixed(2)} NTU. Después de lluvias suele subir.`;
    }
    if (/conductividad/.test(texto)) {
        return `La conductividad indica la cantidad de sales disueltas. Ahora está en ${lectura.conductividad.toFixed(0)} µS/cm y el rango recomendado es ${UMBRALES.conductividad.min}–${UMBRALES.conductividad.max} µS/cm.`;
    }
    if (/ph|riego|agua|tanque|sensor|bater/.test(texto)) {
        return `${resumen}\nPara riego, estos valores son aceptables mientras la clasificación no sea "No apta".`;
    }
    return 'Soy el asistente de calidad del agua de tu comunidad. Pregúntame si el agua es apta para consumo, qué significa la turbidez o la conductividad, o cómo interpretar la última lectura.';
}

function configuracionIA() {
    const claveOpenRouter = process.env.OPENROUTER_API_KEY?.trim();
    if (claveOpenRouter) {
        return {
            tipo: 'openrouter',
            url: process.env.OPENROUTER_URL?.trim() || 'https://openrouter.ai/api/v1/chat/completions',
            modelo: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-3.5-flash-lite',
            clave: claveOpenRouter,
            referer: process.env.OPENROUTER_SITE_URL?.trim() || 'http://localhost:4000',
            titulo: process.env.OPENROUTER_APP_NAME?.trim() || 'WaterMLdetect',
            respaldo: (process.env.OPENROUTER_FALLBACK_MODELS ?? 'upstage/solar-mini4,openrouter/free')
                .split(',')
                .map((modelo) => modelo.trim())
                .filter(Boolean)
        };
    }

    const urlLocal = process.env.LLM_URL?.trim();
    if (urlLocal) {
        return {
            tipo: 'local',
            url: `${urlLocal.replace(/\/+$/, '')}/chat/completions`,
            modelo: process.env.LLM_MODEL?.trim() || 'qwen/qwen3.5-9b',
            clave: process.env.LLM_API_KEY?.trim() || 'lm-studio'
        };
    }

    return null;
}

export function estadoIA() {
    const configuracion = configuracionIA();
    if (!configuracion) return { proveedor: 'local', modelo: 'reglas', disponible: true };
    return {
        proveedor: configuracion.tipo,
        modelo: configuracion.modelo,
        disponible: true
    };
}

async function consultarModelo(mensajes, { temperature = 0.85, maxTokens = 450 } = {}) {
    const configuracion = configuracionIA();
    if (!configuracion) return null;

    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${configuracion.clave}`
    };

    // OpenRouter recomienda identificar la aplicación que consume el modelo.
    if (configuracion.tipo === 'openrouter') {
        headers['HTTP-Referer'] = configuracion.referer;
        headers['X-Title'] = configuracion.titulo;
    }

    const modelos = [configuracion.modelo, ...(configuracion.respaldo || [])]
        .filter((modelo, indice, lista) => modelo && lista.indexOf(modelo) === indice);

    for (const modelo of modelos) {
        try {
            const respuesta = await fetch(configuracion.url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: modelo,
                    messages: mensajes,
                    temperature,
                    max_tokens: maxTokens
                }),
                signal: AbortSignal.timeout(8000)
            });

            if (!respuesta.ok) {
                console.warn(`La IA (${modelo}) respondió con estado ${respuesta.status}; se probará otra opción o el análisis local.`);
                // Sin clave válida o sin saldo no tiene sentido seguir intentando.
                if ([401, 402].includes(respuesta.status)) return null;
                continue;
            }

            const datos = await respuesta.json();
            const contenido = datos.choices?.[0]?.message?.content;
            if (typeof contenido === 'string' && contenido.trim()) return contenido.trim();

            console.warn(`La IA (${modelo}) devolvió una respuesta vacía; se probará otra opción o el análisis local.`);
        } catch (error) {
            console.warn(`No se pudo consultar la IA (${modelo}): ${error.message}. Se probará otra opción o el análisis local.`);
        }
    }

    return null;
}

function compactarLectura(lectura) {
    return {
        fecha: lectura.fecha,
        ph: lectura.ph,
        turbidez: lectura.turbidez,
        conductividad: lectura.conductividad,
        temperatura: lectura.temperatura,
        clasificacion: lectura.clasificacion
    };
}

function muestrear(lecturas, cantidad) {
    const copia = [...lecturas];
    for (let i = copia.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }

    return copia
        .slice(0, cantidad)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function calcularEstadisticas(lecturas) {
    const variables = ['ph', 'turbidez', 'conductividad', 'temperatura'];
    const estadisticas = {};

    for (const variable of variables) {
        const valores = lecturas
            .map((lectura) => Number(lectura[variable]))
            .filter((valor) => Number.isFinite(valor));

        if (!valores.length) {
            estadisticas[variable] = null;
            continue;
        }

        const promedio = valores.reduce((total, valor) => total + valor, 0) / valores.length;
        estadisticas[variable] = {
            minimo: +Math.min(...valores).toFixed(2),
            maximo: +Math.max(...valores).toFixed(2),
            promedio: +promedio.toFixed(2)
        };
    }

    return estadisticas;
}

// Arma el bloque que el modelo interpretará como el resultado de una consulta a la base de datos.
function construirContexto(lectura, lecturas = []) {
    const serie = [...lecturas]
        .filter((item) => item && item.fecha)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    const registros = serie.length ? serie : (lectura ? [lectura] : []);

    return {
        consulta: 'lecturas_recientes_por_tanque',
        origen: process.env.DEMO_MODE === 'true' ? 'base_de_datos_de_prueba' : 'base_de_datos',
        tanque: lectura?.nodoId || registros[0]?.nodoId || null,
        ventana: registros.length
            ? { desde: registros[0].fecha, hasta: registros.at(-1).fecha, total_registros: registros.length }
            : null,
        ultima_lectura: lectura ? compactarLectura(lectura) : null,
        estadisticas_ventana: registros.length ? calcularEstadisticas(registros) : null,
        muestra_aleatoria: muestrear(registros, Math.min(8, registros.length)).map(compactarLectura)
    };
}

function parsearReporteJSON(texto) {
    const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) return null;

    try {
        const datos = JSON.parse(limpio.slice(inicio, fin + 1));
        if (typeof datos.explicacion !== 'string' || !datos.explicacion.trim()) return null;

        const recomendaciones = Array.isArray(datos.recomendaciones)
            ? datos.recomendaciones
                .filter((item) => typeof item === 'string' && item.trim())
                .map((item) => item.trim())
                .slice(0, 3)
            : [];

        return {
            explicacion: datos.explicacion.trim(),
            recomendaciones
        };
    } catch {
        return null;
    }
}

function parsearReporteTexto(texto) {
    const lineas = texto
        .replace(/```/g, '')
        .split(/\r?\n/)
        .map((linea) => linea.replace(/^#+\s*/, '').trim())
        .filter(Boolean);

    const explicacion = [];
    const recomendaciones = [];

    for (const linea of lineas) {
        const vineta = linea.match(/^[-*•]\s+(.+)$/);
        if (vineta) {
            recomendaciones.push(vineta[1].replace(/^["“]|["”]$/g, '').trim());
            continue;
        }

        explicacion.push(
            linea.replace(/^(explicaci[oó]n|an[aá]lisis|reporte|resumen)\s*:\s*/i, '').trim()
        );
    }

    const textoExplicacion = explicacion.join(' ').replace(/\s+/g, ' ').trim();
    if (!textoExplicacion) return null;

    return {
        explicacion: textoExplicacion,
        recomendaciones: recomendaciones.filter(Boolean).slice(0, 3)
    };
}

function parsearReporte(texto) {
    return parsearReporteJSON(texto) || parsearReporteTexto(texto);
}

export async function generarReporte(lectura, contexto = {}) {
    const reporteLocal = generarReporteLocal(lectura);
    if (!lectura) return reporteLocal;

    const datos = construirContexto(lectura, contexto.lecturas);
    const contenido = await consultarModelo(
        [
            { role: 'system', content: PROMPT },
            {
                role: 'user',
                content: `Tarea: genera el reporte de calidad del agua para el tanque ${lectura.nodoId}.\n${instruccionDeEstilo()}\nResponde solo con el formato de reporte indicado en las instrucciones.\n\ncontexto_datos:\n${JSON.stringify(datos, null, 2)}`
            }
        ],
        { temperature: 0.9, maxTokens: 700 }
    );

    if (!contenido) return reporteLocal;

    const parseado = parsearReporte(contenido);
    if (!parseado) {
        return {
            ...reporteLocal,
            explicacion: contenido.slice(0, 900)
        };
    }

    return {
        explicacion: parseado.explicacion,
        recomendaciones: parseado.recomendaciones.length
            ? parseado.recomendaciones
            : reporteLocal.recomendaciones,
        clasificacion: lectura.clasificacion,
        fecha: lectura.fecha,
        fuente: configuracionIA()?.tipo || 'local'
    };
}

export async function responderPregunta(lectura, pregunta, contexto = {}) {
    if (!lectura) {
        return responderConReglas(lectura, pregunta);
    }

    const datos = construirContexto(lectura, contexto.lecturas);
    const contenido = await consultarModelo(
        [
            { role: 'system', content: PROMPT },
            {
                role: 'user',
                content: `Pregunta del usuario: ${pregunta}\n${instruccionDeEstilo()}\nResponde en texto plano, sin JSON.\n\ncontexto_datos:\n${JSON.stringify(datos, null, 2)}`
            }
        ],
        { temperature: 0.95, maxTokens: 420 }
    );

    return contenido || responderConReglas(lectura, pregunta);
}
