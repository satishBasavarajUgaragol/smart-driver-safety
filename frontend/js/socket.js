/**
 * Real-Time WebSocket Client
 * Connects cockpit dashboard and mobile companion to FastAPI backend server with keepalive ping.
 */

class SocketClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 4000;
    this.pingInterval = null;
    this.handlers = {
      onConnect: [],
      onDisconnect: [],
      onAlert: [],
      onTelemetrySync: [],
      onTripReset: [],
    };
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:8000";
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emitEvent("onConnect", { timestamp: Date.now() });
        console.log("WebSocket connected:", wsUrl);

        // Keepalive heartbeat every 4 seconds
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          this.send("PING", { time: Date.now() });
        }, 4000);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleIncomingMessage(payload);
        } catch (e) {
          console.warn("Invalid WS JSON:", e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.emitEvent("onDisconnect", {});
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn("WebSocket error:", err);
      };
    } catch (e) {
      console.warn("WebSocket connection error:", e);
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
    }
    this.isConnected = false;
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(800 * Math.pow(1.3, this.reconnectAttempts), this.maxReconnectDelay);
    setTimeout(() => this.connect(), delay);
  }

  handleIncomingMessage(msg) {
    if (msg.type === "ALERT") {
      this.emitEvent("onAlert", msg);
    } else if (msg.type === "TELEMETRY_SYNC") {
      this.emitEvent("onTelemetrySync", msg.data);
    } else if (msg.type === "TRIP_RESET") {
      this.emitEvent("onTripReset", {});
    }
  }

  send(type, payload = {}) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type, ...payload }));
    } catch (e) {
      console.warn("WS send error:", e);
    }
  }

  sendAlert(alertData) {
    this.send("TRIGGER_ALERT", {
      alert_type: alertData.type,
      title: alertData.title,
      message: alertData.message,
      severity: alertData.severity,
      metrics: alertData.metrics,
      image_base64: alertData.image,
    });
  }

  sendTelemetry(telemetryData) {
    this.send("TELEMETRY", { data: telemetryData });
  }

  on(event, callback) {
    if (this.handlers[event]) {
      this.handlers[event].push(callback);
    }
  }

  emitEvent(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((cb) => cb(data));
    }
  }
}

// Global instance
window.socketClient = new SocketClient();
