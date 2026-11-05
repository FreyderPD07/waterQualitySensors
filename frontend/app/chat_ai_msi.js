const SERVER_URL = "http://192.168.18.183:1235/v1";
const INTEGRATION_NAME = "chat_ia msi"; // Nombre descriptivo de esta integración.
//  ##**api_key="lm-studio"**##nombre que tenia en python

const MODEL_ID = "qwen/qwen3.5-9b"; // Debe coincidir con un ID publicado por GET /v1/models.

async function main() {
  console.log(`Enviando pregunta al servidor ${INTEGRATION_NAME}...`);

  let response;
  try {
    response = await fetch(`${SERVER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer lm-studio",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: "system", content: "Eres un asistente de IA muy servicial." },
          {
            role: "user",
            content:
              "Hola, ¿puedes confirmar si recibiste este mensaje desde la otra PC?",
          },
        ],
        temperature: 0.7,
      }),
    });
  } catch (error) {
    throw new Error(
      `No se pudo conectar con el servidor: ${error.message}`,
    );
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `El servidor respondió HTTP ${response.status}: ${details}`,
    );
  }

  const completion = await response.json();
  const answer = completion.choices?.[0]?.message?.content;
  if (typeof answer !== "string") {
    throw new Error("El servidor respondió, pero no incluyó texto en choices[0].message.content.");
  }

  console.log("\nRespuesta recibida con éxito:");
  console.log(answer);
}

main().catch((error) => {
  console.error(`\n[ERROR] ${error.message}`);
  console.error(`Confirma que ${MODEL_ID} aparezca en ${SERVER_URL}/models`);
  console.error("y que el servidor de LM Studio siga activo en la PC servidor.");
  process.exitCode = 1;
});
