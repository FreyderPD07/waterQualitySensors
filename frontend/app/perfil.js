// Carga los datos del usuario en sesión y envía los cambios al endpoint de perfil.
async function cargarPerfil() {
  try {
    const { usuario } = await llamarApi(CONFIG.endpoints.perfil);
    $("perfil_usuario").value = usuario.usuario || "";
    $("perfil_email").value = usuario.email || "";
    $("perfil_nombre").value = usuario.nombre || "";
    $("perfil_telefono").value = usuario.telefono || "";
    $("perfil_vereda").value = usuario.vereda || "";
  } catch (error) {
    $("error_perfil").value = error.message || "No se pudo cargar el perfil.";
  }
}

const claveSeguraPerfil = (clave) => clave.length >= 8 && clave.length <= 12 && /[A-Z]/.test(clave) && /\d/.test(clave) && /[^A-Za-z0-9]/.test(clave);

// Valida el formulario y guarda los cambios; si hay contraseña nueva, la confirma antes de enviar.
async function guardarPerfil(evento) {
  evento.preventDefault();
  $("error_perfil").value = "";
  $("ok_perfil").value = "";

  const datos = {
    nombre: $("perfil_nombre").value.trim(),
    telefono: $("perfil_telefono").value.trim(),
    vereda: $("perfil_vereda").value.trim()
  };

  if (!datos.nombre || !datos.telefono || !datos.vereda) {
    return ($("error_perfil").value = "Nombre, teléfono y vereda son obligatorios.");
  }
  if (!/^\d{10,15}$/.test(datos.telefono)) {
    return ($("error_perfil").value = "El teléfono debe tener entre 10 y 15 dígitos.");
  }

  const claveNueva = $("perfil_clave").value;
  const claveActual = $("perfil_clave_actual").value;
  if (claveNueva || claveActual) {
    if (!claveActual) return ($("error_perfil").value = "Escribe tu contraseña actual para cambiarla.");
    if (!claveSeguraPerfil(claveNueva)) {
      return ($("error_perfil").value = "La nueva contraseña debe tener de 8 a 12 caracteres, con mayúscula, número y símbolo.");
    }
    if (claveNueva !== $("perfil_clave_confirmar").value) {
      return ($("error_perfil").value = "Las contraseñas nuevas no coinciden.");
    }
    datos.password = claveNueva;
    datos.passwordActual = claveActual;
  }

  try {
    const respuesta = await llamarApi(CONFIG.endpoints.perfil, { method: "PUT", body: JSON.stringify(datos) });
    // Actualiza la sesión local con el token y los datos renovados.
    sesion = { ...respuesta.usuario, token: respuesta.token };
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    $("ok_perfil").value = "Perfil actualizado correctamente.";
    $("perfil_clave").value = "";
    $("perfil_clave_actual").value = "";
    $("perfil_clave_confirmar").value = "";
  } catch (error) {
    $("error_perfil").value = error.message || "No se pudieron guardar los cambios.";
  }
}

function conectarPerfil() {
  if (!$("form_perfil")) return;
  if (!sesion) {
    window.location.replace("login.html");
    return;
  }
  $("form_perfil").addEventListener("submit", guardarPerfil);
  $("boton_salir_perfil")?.addEventListener("click", cerrarSesion);
  cargarPerfil();
}

conectarPerfil();
