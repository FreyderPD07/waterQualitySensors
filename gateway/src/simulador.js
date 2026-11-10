import { clasificarLectura } from './calidad.js';

export const TANQUES_DEMO = [
    { nodoId: 'nodo-01', nombre: 'Tanque San Pedro 01' },
    { nodoId: 'nodo-02', nombre: 'Tanque San Pedro 02' }
];

// Datos sintéticos reproducibles relativos al momento de la consulta; nunca se guardan en MongoDB.
export function obtenerLecturasDemo({ nodoId, desde, hasta, limite = 2000 } = {}) {
    const ahora = Date.now();
    const ids = nodoId ? [String(nodoId)] : TANQUES_DEMO.map((tanque) => tanque.nodoId);
    const lecturas = [];

    for (const [indice, id] of ids.entries()) {
        for (let horasAtras = 7 * 24; horasAtras >= 0; horasAtras -= 3) {
            const fechaMs = ahora - horasAtras * 60 * 60 * 1000;
            const fase = (7 * 24 - horasAtras) / 5 + indice;
            const eventoLluvia = indice === 0 && horasAtras <= 12 ? (13 - horasAtras) * 0.55 : 0;
            const lectura = {
                nodoId: id,
                fecha: new Date(fechaMs).toISOString(),
                ph: +(7.2 + Math.sin(fase) * 0.25).toFixed(2),
                turbidez: +(1.3 + Math.abs(Math.sin(fase * 1.7)) * 0.8 + eventoLluvia).toFixed(2),
                conductividad: Math.round(410 + Math.sin(fase * 0.7) * 45 + indice * 30),
                temperatura: +(19 + Math.sin(fase * 0.45) * 2.2).toFixed(1),
                bateria: Math.max(62, Math.round(96 - (7 * 24 - horasAtras) * 0.18 - indice * 13)),
                rssi: -Math.round(91 + Math.abs(Math.sin(fase)) * 13),
                snr: +(4 + Math.abs(Math.cos(fase)) * 5).toFixed(1)
            };
            lectura.clasificacion = clasificarLectura(lectura);
            lecturas.push(lectura);
        }
    }

    const desdeMs = desde ? new Date(desde).getTime() : -Infinity;
    const hastaMs = hasta
        ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(hasta) ? `${hasta}T23:59:59.999` : hasta).getTime()
        : Infinity;

    return lecturas
        .filter((lectura) => {
            const fecha = new Date(lectura.fecha).getTime();
            return fecha >= desdeMs && fecha <= hastaMs;
        })
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
        .slice(-limite);
}

export function obtenerTanquesDemo() {
    return TANQUES_DEMO;
}

export function obtenerUltimaLecturaDemo(nodoId) {
    const lecturas = obtenerLecturasDemo({ nodoId, limite: 1000 });
    return lecturas.at(-1) || null;
}
