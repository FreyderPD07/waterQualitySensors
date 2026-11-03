const DashboardCharts = (() => {
  const charts = new Map();

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
      borderColor: "#2a9de0",
      backgroundColor: "rgba(79,176,234,.18)",
      fill: true,
      tension: .3,
      pointRadius: lecturas.length > 60 ? 0 : 3
    }];

    if (configuracion.max !== undefined) conjuntos.push(lineaUmbral(configuracion.max, "#d32f2f"));
    if (configuracion.min !== undefined) conjuntos.push(lineaUmbral(configuracion.min, "#ed6c02"));

    charts.get(canvas)?.destroy();
    charts.set(canvas, new Chart(canvas, {
      type: "line",
      data: { labels: etiquetas, datasets: conjuntos },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 8 } } }
      }
    }));
  }

  return Object.freeze({ dibujar });
})();
