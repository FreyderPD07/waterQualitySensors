import pymongo
import random
import time 
from datetime import datetime

try:
    #para crear una nueva base de datos y coleccion directamente ingresamos nuevos nombre
    #y autematicamente se crea la base de datos y coleccion en mongoDB Atlas 
    client = pymongo.MongoClient("mongodb+srv://QualitySensor_db_user:QveLwCr4ugoIJwpd@clustersensores0.ylsfqri.mongodb.net/?appName=ClusterSensores0")
    db = client["monitoreoAguaSimulado"]
    coleccion = db["lecturaSimulado"]
    print("conexion exitosa a Mongo DB")
except Exception as e:
    print(f"Error al conectar a Mongo DB: {e}")

#2. Funcion paa generar datos realistas 
def generar_lecturas():
    return {
        "fecha": datetime.now(),
        "dispositivo": "tanque de pruebas local",
        "ph": round(random.uniform(6.5, 8.5), 2),
        "turbidez": round(random.uniform(1.0, 10.0), 2),
        "oxigeno_disuelto": round(random.uniform(5.0, 9.0), 2),
        "nitritos": round(random.uniform(0.0, 10.5), 2),
    }

# Bucle infinito para enviar datos 
print("Iniciando simulador de sensores... Preciona ctrl + c para detener.")

try: 
    while True:
        datos = generar_lecturas()
        coleccion.insert_one(datos)
        print(f"Datso enviado a los {datos['fecha'].strftime('%H-%M-%S')}: pH {datos['ph']} |nitritos {datos['nitritos']} |turbidez {datos['turbidez']} |oxigeno disuelto {datos['oxigeno_disuelto']}")
        time.sleep(5)  # Espera 5 segundos antes de enviar la siguiente lectura
except KeyboardInterrupt:
    print("Simulador detenido por el usuario.")