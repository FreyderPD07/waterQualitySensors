# 💧 Water Quality Sensors — Sistema de Monitoreo de Calidad del Agua

Sistema de telemetría de baja potencia basado en **LoRaWAN** para el monitoreo en tiempo real de parámetros críticos del agua. Captura datos desde sensores sumergibles, los transmite de forma inalámbrica, los almacena en una base de datos NoSQL y los representa visualmente en un dashboard interactivo.

---

## Descripción General

El sistema está diseñado para cubrir tres responsabilidades principales:

1. **Captura de datos** — recibe lecturas desde sensores físicos vía red LoRaWAN.
2. **Persistencia y organización** — almacena y gestiona la información en una base de datos NoSQL.
3. **Representación gráfica** — presenta los datos procesados en un dashboard con alertas y tendencias.

---

## Arquitectura del Sistema

Se aplica una **Arquitectura en Capas (Layered Architecture)** con el patrón **MVC** en la capa de presentación. Este enfoque permite separar claramente las responsabilidades, facilitar el mantenimiento y escalar cada capa de forma independiente.

```
┌──────────────────────────────────────────────┐
│           CAPA DE PRESENTACIÓN               │
│  Views: Dashboard, Gráficas, Reportes        │
│  Controllers: Solicitudes HTTP / WebSocket   │
├──────────────────────────────────────────────┤
│           CAPA DE NEGOCIO (Services)         │
│  Procesamiento de lecturas                   │
│  Motor de alertas y umbrales                 │
│  Análisis de tendencias                      │
├──────────────────────────────────────────────┤
│           CAPA DE DATOS (Repositories)       │
│  Modelos de datos (sensores, lecturas)       │
│  Acceso a base de datos NoSQL                │
├──────────────────────────────────────────────┤
│           CAPA DE ADQUISICIÓN (IoT Gateway)  │
│  Recepción de paquetes LoRaWAN               │
│  Validación y normalización de tramas        │
│  Publicación interna vía MQTT / HTTP         │
└──────────────────────────────────────────────┘
```

### ¿Por qué esta arquitectura?

| Criterio | Decisión |
|---|---|
| Separación de responsabilidades | Cada capa tiene un rol único y no se mezclan con las demás |
| Escalabilidad | Cada capa puede crecer o reemplazarse sin romper las otras |
| IoT + Web en el mismo sistema | La capa de adquisición desacopla el hardware del resto del software |
| Representación gráfica | MVC en presentación mantiene limpio el manejo de vistas y datos |

---

## Estructura de Carpetas

```
waterQualitySensors/
│
├── acquisition/              # Capa de adquisición (IoT Gateway)
│   ├── lorawan_listener.js   # Escucha y recibe paquetes LoRaWAN
│   ├── payload_parser.js     # Decodifica y valida las tramas de los sensores
│   └── mqtt_publisher.js     # Publica los datos normalizados internamente
│
├── data/                     # Capa de datos
│   ├── models/               # Definición de esquemas (sensores, lecturas, alertas)
│   └── repositories/         # Acceso y consultas a la base de datos NoSQL
│
├── services/                 # Capa de negocio
│   ├── reading_service.js    # Lógica de procesamiento de lecturas
│   ├── alert_service.js      # Evaluación de umbrales y generación de alertas
│   └── trend_service.js      # Cálculo de tendencias y estadísticas
│
├── presentation/             # Capa de presentación (MVC)
│   ├── controllers/          # Controladores HTTP / WebSocket
│   ├── views/                # Plantillas o componentes del dashboard
│   └── routes/               # Definición de rutas de la API y UI
│
├── config/                   # Configuración del sistema (DB, red, umbrales)
├── tests/                    # Pruebas unitarias e integración
└── README.md
```

---

## Parámetros Monitoreados

Los sensores sumergibles capturan los siguientes parámetros:

| Parámetro | Unidad | Descripción |
|---|---|---|
| pH | — | Nivel de acidez o alcalinidad del agua |
| Turbidez | NTU | Claridad del agua |
| Temperatura | °C | Temperatura del cuerpo de agua |
| Conductividad | µS/cm | Concentración de sales disueltas |
| Oxígeno Disuelto | mg/L | Nivel de oxígeno disponible en el agua |

---

## Flujo de Datos

```
[Sensor] → [Red LoRaWAN] → [Gateway IoT]
                                 │
                          [Normalización]
                                 │
                        [Base de Datos NoSQL]
                                 │
                     ┌───────────┴───────────┐
                 [Servicios]           [API / WebSocket]
              (alertas, análisis)             │
                                       [Dashboard]
                                    (gráficas en tiempo real)
```

---

## Tecnologías (propuestas)

| Componente | Tecnología sugerida |
|---|---|
| Gateway LoRaWAN | The Things Network (TTN) / ChirpStack |
| Backend | Node.js / Python (FastAPI) |
| Base de datos | MongoDB o InfluxDB (series de tiempo) |
| Mensajería interna | MQTT (Mosquitto) |
| Dashboard | Grafana / React + Chart.js |
| API | REST + WebSocket |

---

## Estado del Proyecto
### 1 cuando ya se esta trabajando, 0 cuando no se a  implementado

- [1] Definición de arquitectura
- [1] Configuración del gateway LoRaWAN
- [1] Modelos de datos y repositorios
- [0] Servicios de procesamiento y alertas
- [0] API REST y WebSocket
- [0] Dashboard de visualización
- [0] Pruebas e integración

---

## Notas

- La base de datos NoSQL se elige por su flexibilidad ante estructuras de datos variables provenientes de distintos tipos de sensores.
- Si la prioridad es análisis temporal (series de tiempo), **InfluxDB** es preferible sobre MongoDB.
- El sistema está diseñado para ser **extensible**: agregar nuevos tipos de sensores o nuevas vistas no requiere modificar las capas subyacentes.
