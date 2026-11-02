/**
 * Real-Time Telemetry Graphing & Dashboard Gauge Visualizer
 * Manages Chart.js rolling curves and dynamic SVG circular progress rings.
 */

class DashboardCharts {
  constructor() {
    this.chart = null;
    this.maxDataPoints = 30;
    this.labels = [];
    this.earData = [];
    this.marData = [];
  }

  init(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Initialize with empty points
    for (let i = 0; i < this.maxDataPoints; i++) {
      this.labels.push("");
      this.earData.push(0.3);
      this.marData.push(0.2);
    }

    this.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: this.labels,
        datasets: [
          {
            label: "Eye Aspect Ratio (EAR)",
            data: this.earData,
            borderColor: "#00f2fe",
            backgroundColor: "rgba(0, 242, 254, 0.1)",
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 0,
          },
          {
            label: "Mouth Aspect Ratio (MAR)",
            data: this.marData,
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "#94a3b8",
              font: { size: 11, family: "Inter, sans-serif" },
              boxWidth: 12,
            },
          },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            display: false,
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 1.0,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#64748b",
              font: { size: 10 },
              stepSize: 0.25,
            },
          },
        },
      },
    });
  }

  updateTelemetry(ear, mar) {
    if (!this.chart) return;

    this.earData.push(ear);
    this.earData.shift();

    this.marData.push(mar);
    this.marData.shift();

    this.chart.update("none");
  }

  updateSafetyScoreRing(score) {
    const ring = document.getElementById("safety-score-ring");
    const numEl = document.getElementById("safety-score-val");
    if (!ring || !numEl) return;

    numEl.textContent = score;

    // Circumference = 2 * PI * r = 2 * 3.14159 * 45 = ~283
    const circumference = 283;
    const offset = circumference - (score / 100) * circumference;
    ring.style.strokeDashoffset = offset;

    // Color gradient shift based on score
    if (score >= 75) {
      ring.style.stroke = "#10b981"; // Emerald Green
    } else if (score >= 45) {
      ring.style.stroke = "#f59e0b"; // Amber Warning
    } else {
      ring.style.stroke = "#ef4444"; // Crimson Alert
    }
  }
}

// Global instance
window.dashboardCharts = new DashboardCharts();
