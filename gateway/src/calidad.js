// Umbrales de calidad del agua compartidos por la clasificación y las alertas.
export const UMBRALES = {
    ph:            { nombre: 'pH',            unidad: '',      min: 6.5, max: 8.5,  margen: 0.3, escala: [0, 14],   decimales: 2 },
    turbidez:      { nombre: 'Turbidez',      unidad: 'NTU',   max: 5,             margen: 1,   escala: [0, 10],   decimales: 2 },
    conductividad: { nombre: 'Conductividad', unidad: 'µS/cm', min: 100, max: 1000, margen: 80,  escala: [0, 1400], decimales: 0 },
    temperatura:   { nombre: 'Temperatura',   unidad: '°C',    min: 10,  max: 30,   margen: 2,   escala: [0, 40],   decimales: 1 }
};

export const VARIABLES = Object.keys(UMBRALES);

function numero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const convertido = Number(String(valor).replace(',', '.'));
    return Number.isFinite(convertido) ? convertido : null;
}

function primerNumero(objeto, claves) {
    for (const clave of claves) {
        const valor = numero(objeto?.[clave]);
        if (valor !== null) return valor;
    }
    return null;
}

// Convierte un documento de MongoDB al formato que consume el frontend.
export function normalizarLectura(documento) {
    if (!documento) return null;

    const datos = documento.datos && typeof documento.datos === 'object' && !Array.isArray(documento.datos)
        ? documento.datos
        : {};

    const nodoId = documento.nodoId ?? documento.sensorId ?? documento.sensorid;
    const fechaOriginal = documento.fecha ?? documento.recibidoEn ?? documento.capturadoEn;
    if (!nodoId || !fechaOriginal) return null;

    const fecha = new Date(fechaOriginal);
    if (Number.isNaN(fecha.getTime())) return null;

    const ph = primerNumero(datos, ['ph', 'pH', 'PH']) ?? numero(documento.ph);
    const turbidez = primerNumero(datos, ['turbidez', 'turbidity', 'ntu']) ?? numero(documento.turbidez);
    const conductividad = primerNumero(datos, ['conductividad', 'conductivity', 'ec', 'tds']) ?? numero(documento.conductividad);
    const temperatura = primerNumero(datos, ['temperatura', 'temperature', 'temp']) ?? numero(documento.temperatura);

    // Si falta un parámetro no se muestra la lectura para evitar valores falsos en el dashboard.
    if ([ph, turbidez, conductividad, temperatura].some((valor) => valor === null)) return null;

    const lectura = {
        nodoId: String(nodoId),
        fecha: fecha.toISOString(),
        ph,
        turbidez,
        conductividad,
        temperatura,
        bateria: primerNumero(datos, ['bateria', 'battery', 'battery_percentage', 'last_battery_percentage'])
            ?? numero(documento.bateria)
            ?? 100,
        rssi: primerNumero(datos, ['rssi']) ?? numero(documento.rssi) ?? -100,
        snr: primerNumero(datos, ['snr']) ?? numero(documento.snr) ?? 0
    };

    lectura.clasificacion = documento.clasificacion || clasificarLectura(lectura);
    return lectura;
}

export function estadoParametro(variable, valor) {
    const configuracion = UMBRALES[variable];
    if (!configuracion || valor === null || valor === undefined) return 'sin_dato';
    if ((configuracion.min !== undefined && valor < configuracion.min) ||
        (configuracion.max !== undefined && valor > configuracion.max)) return 'fuera';
    if ((configuracion.max !== undefined && valor > configuracion.max - configuracion.margen) ||
        (configuracion.min !== undefined && valor < configuracion.min + configuracion.margen)) return 'alerta';
    return 'ok';
}

export function clasificarLectura(lectura) {
    const estados = ['ph', 'turbidez', 'conductividad'].map((variable) => estadoParametro(variable, lectura[variable]));
    const fueraDeRango = estados.filter((estado) => estado === 'fuera').length;
    const cercaDelLimite = estados.filter((estado) => estado === 'alerta').length;

    if (fueraDeRango >= 2) return 'No apta';
    if (fueraDeRango === 1) return 'Riesgo';
    return cercaDelLimite > 0 ? 'Aceptable' : 'Buena';
}

export function generarAlertas(lecturas, limite = 50) {
    const resultado = [];
    const ahora = Date.now();
    const desde = ahora - 7 * 24 * 60 * 60 * 1000;

    const recientes = lecturas
        .filter((lectura) => new Date(lectura.fecha).getTime() >= desde)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    for (const lectura of recientes) {
        for (const variable of VARIABLES) {
            const estado = estadoParametro(variable, lectura[variable]);
            if (estado === 'ok' || estado === 'sin_dato') continue;

            const horasDeAntiguedad = (ahora - new Date(lectura.fecha).getTime()) / 3600000;
            const configuracion = UMBRALES[variable];

            resultado.push({
                id: `${lectura.nodoId}-${variable}-${lectura.fecha}`,
                severidad: horasDeAntiguedad > 36 ? 'resuelta' : estado === 'fuera' ? 'critica' : 'advertencia',
                titulo: `${configuracion.nombre} ${estado === 'fuera' ? 'fuera de norma' : 'cerca del límite'} - ${lectura.nodoId}`,
                mensaje: `Valor registrado: ${lectura[variable].toFixed(configuracion.decimales)} ${configuracion.unidad}`,
                fecha: lectura.fecha,
                nodoId: lectura.nodoId,
                leida: false
            });

            if (resultado.length >= limite) return resultado;
        }
    }

    return resultado;
}
