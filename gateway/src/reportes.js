import { requireAuth, requireAdmin, filtroIdDocumento } from './auth.js';
import { getDb } from './db.js';

const COLECCION = 'reportes';
const demoMode = () => process.env.DEMO_MODE === 'true';
const reportesDemo = [];

function reportePublico(documento) {
    return {
        id: String(documento._id),
        usuario: documento.usuario,
        email: documento.email,
        nodoId: documento.nodoId,
        variable: documento.variable,
        mensaje: documento.mensaje,
        estado: documento.estado || 'pendiente',
        creadoEn: documento.creadoEn
    };
}

export async function reportesRoutes(fastify) {
    // Cualquier usuario con sesión puede avisar al administrador cuando un parámetro se altera.
    fastify.post('/api/reportes', { preHandler: requireAuth }, async (request, reply) => {
        const { nodoId, variable, mensaje } = request.body || {};

        if (typeof mensaje !== 'string' || mensaje.trim().length < 5) {
            return reply.code(400).send({ status: 'error', message: 'Describe brevemente el problema detectado (mínimo 5 caracteres).' });
        }
        if (mensaje.length > 600) {
            return reply.code(400).send({ status: 'error', message: 'El reporte no puede superar los 600 caracteres.' });
        }

        const documento = {
            usuarioId: String(request.usuario.sub),
            usuario: request.usuario.nombre || 'Usuario',
            email: request.usuario.email || '',
            nodoId: typeof nodoId === 'string' ? nodoId.slice(0, 60) : '',
            variable: typeof variable === 'string' ? variable.slice(0, 40) : '',
            mensaje: mensaje.trim(),
            estado: 'pendiente',
            creadoEn: new Date().toISOString()
        };

        if (demoMode()) {
            documento._id = `reporte-${reportesDemo.length + 1}`;
            reportesDemo.push(documento);
        } else {
            const resultado = await getDb().collection(COLECCION).insertOne(documento);
            documento._id = resultado.insertedId;
        }

        return reply.code(201).send({ status: 'ok', reporte: reportePublico(documento) });
    });

    // Solo el administrador consulta y gestiona los reportes recibidos.
    fastify.get('/api/reportes', { preHandler: requireAdmin }, async () => {
        if (demoMode()) {
            return [...reportesDemo].reverse().map(reportePublico);
        }
        const documentos = await getDb()
            .collection(COLECCION)
            .find({})
            .sort({ creadoEn: -1 })
            .limit(200)
            .toArray();
        return documentos.map(reportePublico);
    });

    fastify.patch('/api/reportes/:id', { preHandler: requireAdmin }, async (request, reply) => {
        const { estado } = request.body || {};
        if (!['pendiente', 'en_revision', 'resuelto'].includes(estado)) {
            return reply.code(400).send({ status: 'error', message: 'Estado no válido.' });
        }

        const filtro = demoMode()
            ? { _id: request.params.id }
            : filtroIdDocumento(request.params.id);

        if (demoMode()) {
            const reporte = reportesDemo.find((item) => item._id === request.params.id);
            if (!reporte) return reply.code(404).send({ status: 'error', message: 'Reporte no encontrado.' });
            reporte.estado = estado;
            return { status: 'ok', reporte: reportePublico(reporte) };
        }

        const resultado = await getDb().collection(COLECCION).findOneAndUpdate(
            filtro,
            { $set: { estado } },
            { returnDocument: 'after' }
        );
        if (!resultado) return reply.code(404).send({ status: 'error', message: 'Reporte no encontrado.' });
        return { status: 'ok', reporte: reportePublico(resultado) };
    });
}
