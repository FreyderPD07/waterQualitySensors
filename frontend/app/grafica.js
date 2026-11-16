const DashboardCharts = (() => {
  const charts = new Map();

  // Tema claro consistente con el resto de la interfaz.
  const COLOR_ejes = "#47617e";
  const COLOR_rejilla = "rgba(13,58,102,.08)";

  function dibujar(canvas, lecturas, variable, configuracion) {
    if (typeof Chart === "undefined" || !canvas) return;

    const etiquetas = lecturas.map((lectura) =>
      new Date(lectura.fecha).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      })
    );
    const lineaUmbral = (valor, color) => ({
      data: lecturas.map(() => valor),
      borderColor: color,
      borderDash: [6, 4],
      pointRadius: 0,
      borderWidth: 1.5
    });
    const conjuntos = [{
      label: `${configuracion.nombre} ${configuracion.unidad}`,
      data: lecturas.map((lectura) => lectura[variable]),
      borderColor: "#1d6fd1",
      backgroundColor: "rgba(29,111,209,.1)",
      fill: true,
      tension: .3,
      pointRadius: lecturas.length > 60 ? 0 : 3,
      pointBackgroundColor: "#1d6fd1",
      pointBorderColor: "#ffffff",
      pointBorderWidth: 1.5
    }];

    if (configuracion.max !== undefined) conjuntos.push(lineaUmbral(configuracion.max, "#c92a3e"));
    if (configuracion.min !== undefined) conjuntos.push(lineaUmbral(configuracion.min, "#b45309"));

    charts.get(canvas)?.destroy();
    charts.set(canvas, new Chart(canvas, {
      type: "line",
      data: { labels: etiquetas, datasets: conjuntos },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, color: COLOR_ejes },
            grid: { color: COLOR_rejilla }
          },
          y: {
            ticks: { color: COLOR_ejes },
            grid: { color: COLOR_rejilla }
          }
        }
      }
    }));
  }

  return Object.freeze({ dibujar });
})();
