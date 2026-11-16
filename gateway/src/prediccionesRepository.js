import { getDb } from './db.js';
import { obtenerLecturasDemo } from './simulador.js';

// Colección independiente de "lecturas": aquí solo se guarda la salida del modelo
// (Random Forest) junto con las entradas que la produjeron, para poder auditar
// cada predicción sin mezclarla con los datos crudos del sensor.
const COLECCION = 'predicciones';
const MODELO = 'random_forest';

function normalizarFecha(valor, finDelDia = false) {
    if (!valor) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return `${valor}T${finDelDia ? '23:59:59.999' : '00:00:00.000'}Z`;
    }
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

// Inserta un documento de predicción ya normalizado.
export async function guardarPrediccion(prediccion) {
    if (!prediccion?.nodoId || !prediccion.fecha || !prediccion.clase) return null;
    const documento = {
        nodoId: String(prediccion.nodoId),
        fecha: new Date(prediccion.fecha).toISOString(),
        clase: String(prediccion.clase),
        confianza: typeof prediccion.confianza === 'number' ? prediccion.confianza : null,
        modelo: prediccion.modelo || MODELO,
        entradas: {
            ph: prediccion.ph ?? null,
            turbidez: prediccion.turbidez ?? null,
            conductividad: prediccion.conductividad ?? null,
            temperatura: prediccion.temperatura ?? null
        }
    };
    const resultado = await getDb().collection(COLECCION).insertOne(documento);
    return resultado.insertedId;
}

// A partir de una lectura normalizada genera y guarda la predicción del modelo.
// La clasificación actual actúa como salida del Random Forest; cuando el modelo
// real esté integrado, aquí se invocará y se guardará también la confianza.
export async function registrarPrediccion(lectura) {
    if (!lectura?.nodoId || !lectura.fecha || !lectura.clasificacion) return null;
    return guardarPrediccion({
        nodoId: lectura.nodoId,
        fecha: lectura.fecha,
        clase: lectura.clasificacion,
        entradas: {
            ph: lectura.ph,
            turbidez: lectura.turbidez,
            conductividad: lectura.conductividad,
            temperatura: lectura.temperatura
        }
    });
}

// Consulta las predicciones guardadas, filtradas por nodo y rango de fechas.
export async function obtenerPredicciones({ nodoId, desde, hasta, limite = 5000 } = {}) {
    const filtro = {};
    if (nodoId) filtro.nodoId = String(nodoId);

    const desdeNormalizado = normalizarFecha(desde);
    const hastaNormalizado = normalizarFecha(hasta, true);
    if (desdeNormalizado || hastaNormalizado) {
        filtro.fecha = {};
        if (desdeNormalizado) filtro.fecha.$gte = desdeNormalizado;
        if (hastaNormalizado) filtro.fecha.$lte = hastaNormalizado;
    }

    const documentos = await getDb()
        .collection(COLECCION)
        .find(filtro)
        .sort({ fecha: 1 })
        .limit(Math.min(Math.max(Number(limite) || 5000, 1), 20000))
        .toArray();

    return documentos.map((documento) => ({
        nodoId: documento.nodoId,
        fecha: documento.fecha,
        clase: documento.clase,
        confianza: documento.confianza ?? null,
        modelo: documento.modelo || MODELO,
        entradas: documento.entradas || {}
    }));
}

// Versión de demostración: deriva las predicciones de las lecturas simuladas.
// En modo demo nada se persiste, igual que las lecturas.
export function obtenerPrediccionesDemo({ nodoId, desde, hasta, limite = 5000 } = {}) {
    const lecturas = obtenerLecturasDemo({ nodoId, desde, hasta, limite });
    return lecturas.map((lectura) => ({
        nodoId: lectura.nodoId,
        fecha: lectura.fecha,
        clase: lectura.clasificacion,
        confianza: null,
        modelo: MODELO,
        entradas: {
            ph: lectura.ph,
            turbidez: lectura.turbidez,
            conductividad: lectura.conductividad,
            temperatura: lectura.temperatura
        }
    }));
}

