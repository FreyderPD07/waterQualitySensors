// Envía las credenciales al endpoint de login y guarda los datos de sesión recibidos.
async function iniciarSesion(evento) {
  evento.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(evento.target));
  if (!email.trim() || !password) return ($("error_login").value = "Este campo es obligatorio.");
  if (!correoValido(email)) return ($("error_login").value = "Formato de correo no válido.");
  try {
    sesion = CONFIG.usarDatosDemo
      ? { nombre: email.split("@")[0], rol: "comunero", token: "demo" }
      : await llamarApi(CONFIG.endpoints.login, { method: "POST", body: JSON.stringify({ email, password }) }).then((respuestaLogin) => ({ ...respuestaLogin.usuario, token: respuestaLogin.token }));
    $("error_login").value = "";
  } catch {
    $("error_login").value = "El correo electrónico o la contraseña son incorrectos.";
    return;
  }
  entrarALaAplicacion();
}

const formularioLogin = $("form_login");
if (formularioLogin) {
  if (sesion) {
    window.location.replace("dashboard.html");
  } else {
    formularioLogin.addEventListener("submit", iniciarSesion);
  }
}
