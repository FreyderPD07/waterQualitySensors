const claveSegura = (clave) => clave.length >= 8 && clave.length <= 12 && /[A-Z]/.test(clave) && /\d/.test(clave) && /[^A-Za-z0-9]/.test(clave);

// Valida localmente el formulario de registro antes de enviarlo al backend.
function validarRegistro(datos) {
  if (Object.values(datos).some((valor) => !valor.trim())) return "Todos los campos son obligatorios.";
  if (!/^[a-zA-Z0-9]{1,50}$/.test(datos.usuario)) return "El usuario solo admite letras y números.";
  if (!correoValido(datos.email)) return "Formato de correo no válido.";
  if (!/^\d{10,15}$/.test(datos.telefono)) return "El teléfono debe tener entre 10 y 15 dígitos.";
  if (!claveSegura(datos.password)) return "La contraseña debe tener de 8 a 12 caracteres, con mayúscula, número y símbolo.";
  if (datos.password !== datos.confirmacion) return "Las contraseñas no coinciden.";
  return "";
}

// Valida los datos del formulario y crea la cuenta mediante el endpoint de registro.
async function registrarUsuario(evento) {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(evento.target));
  const error = validarRegistro(datos);
  $("error_registro").value = error;
  if (error) return;
  try {
    if (!CONFIG.usarDatosDemo) await llamarApi(CONFIG.endpoints.registro, { method: "POST", body: JSON.stringify(datos) });
    sesion = { nombre: datos.nombre, rol: "comunero", token: "demo" };
  } catch {
    $("error_registro").value = "No se pudo crear la cuenta. Revisa si el correo ya está registrado.";
    return;
  }
  entrarALaAplicacion();
}

const formularioRegistro = $("form_registro");
if (formularioRegistro) {
  if (sesion) {
    window.location.replace("dashboard.html");
  } else {
    formularioRegistro.addEventListener("submit", registrarUsuario);
  }
}
