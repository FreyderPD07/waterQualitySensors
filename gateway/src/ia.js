import './env.js';
import { UMBRALES, estadoParametro } from './calidad.js';

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

export function generarReporte(lectura) {
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

async function consultarLLM(lectura, pregunta) {
    const url = process.env.LLM_URL;
    if (!url) return null;

    const modelo = process.env.LLM_MODEL || 'qwen/qwen3.5-9b';
    const clave = process.env.LLM_API_KEY || 'lm-studio';

    try {
        const respuesta = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${clave}`
            },
            body: JSON.stringify({
                model: modelo,
                messages: [
                    {
                        role: 'system',
                        content: 'Eres un asistente experto en calidad del agua. Responde en español, de forma clara, breve y útil para una comunidad rural. Usa únicamente el contexto de la lectura para dar recomendaciones.'
                    },
                    {
                        role: 'user',
                        content: `Contexto de la última lectura: ${JSON.stringify(lectura)}.\nPregunta: ${pregunta}`
                    }
                ],
                temperature: 0.3
            }),
            signal: AbortSignal.timeout(12000)
        });

        if (!respuesta.ok) return null;

        const datos = await respuesta.json();
        const contenido = datos.choices?.[0]?.message?.content;
        return typeof contenido === 'string' && contenido.trim() ? contenido.trim() : null;
    } catch {
        return null;
    }
}

export async function responderPregunta(lectura, pregunta) {
    const respuestaLLM = await consultarLLM(lectura, pregunta);
    return respuestaLLM || responderConReglas(lectura, pregunta);
}
