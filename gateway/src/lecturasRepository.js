import { getDb } from './db.js';
import { normalizarLectura } from './calidad.js';
import { registrarPrediccion } from './prediccionesRepository.js';

const COLECCION = 'lecturas';

export async function guardarLectura(lectura) {
    try {
        if (!lectura || !lectura.sensorId || !lectura.recibidoEn || !lectura.datos) {
            throw new Error('Faltan campos obligatorios en la lectura');
        }

        if (typeof lectura.datos !== 'object' ||
            Array.isArray(lectura.datos) ||
            Object.keys(lectura.datos).length === 0) {
            throw new Error('El campo datos debe ser un objeto no vacío');
        }

        const documento = {
            sensorId: String(lectura.sensorId),
            recibidoEn: lectura.recibidoEn,
            datos: lectura.datos
        };

        if (lectura.rssi !== undefined) documento.rssi = lectura.rssi;
        if (lectura.snr !== undefined) documento.snr = lectura.snr;
        if (lectura.bateria !== undefined) documento.bateria = lectura.bateria;

        const resultado = await getDb().collection(COLECCION).insertOne(documento);
        console.log('Lectura guardada correctamente', resultado.insertedId);

        // La predicción del modelo se guarda en su propia colección, separada del dato crudo.
        const normalizada = normalizarLectura(documento);
        if (normalizada) {
            registrarPrediccion(normalizada).catch((error) =>
                console.error('No se pudo guardar la predicción', error));
        }
        return resultado.insertedId;
    } catch (error) {
        console.error('Error al guardar la lectura', error);
        throw error;
    }
}

function normalizarFecha(valor, finDelDia = false) {
    if (!valor) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return `${valor}T${finDelDia ? '23:59:59.999' : '00:00:00.000'}Z`;
    }
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export async function obtenerLecturas({ nodoId, desde, hasta, limite = 2000 } = {}) {
    const filtro = {};
    if (nodoId) filtro.sensorId = String(nodoId);

    const desdeNormalizado = normalizarFecha(desde);
    const hastaNormalizado = normalizarFecha(hasta, true);
    if (desdeNormalizado || hastaNormalizado) {
        filtro.recibidoEn = {};
        if (desdeNormalizado) filtro.recibidoEn.$gte = desdeNormalizado;
        if (hastaNormalizado) filtro.recibidoEn.$lte = hastaNormalizado;
    }

    const documentos = await getDb()
        .collection(COLECCION)
        .find(filtro)
        .sort({ recibidoEn: 1 })
        .limit(limite)
        .toArray();

    return documentos.map(normalizarLectura).filter(Boolean);
}

export async function obtenerTanques() {
    const db = getDb();
    const ids = new Set(
        (await db.collection(COLECCION).distinct('sensorId'))
            .filter(Boolean)
            .map((id) => String(id))
    );

    const tanques = await db.collection('tanques').find({}).toArray();
    const nombres = new Map();
    for (const tanque of tanques) {
        const id = String(tanque.nodoId ?? tanque.sensorId ?? '');
        if (!id) continue;
        ids.add(id);
        nombres.set(id, tanque.nombre || `Tanque ${id}`);
    }

    return [...ids]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ nodoId: id, nombre: nombres.get(id) || `Tanque ${id}` }));
}

export async function obtenerUltimaLectura(nodoId) {
    const filtro = nodoId ? { sensorId: String(nodoId) } : {};
    const [documento] = await getDb()
        .collection(COLECCION)
        .find(filtro)
        .sort({ recibidoEn: -1 })
        .limit(1)
        .toArray();

    return normalizarLectura(documento);
}
