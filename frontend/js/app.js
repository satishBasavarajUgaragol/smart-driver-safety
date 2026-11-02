/**
 * Main Cockpit HUD Dashboard Application Controller
 * Coordinates Video Camera, Computer Vision, Audio Synthesizer, WebSockets,
 * Tier 4 Multi-Channel Cloud Dispatch, and Incident Blackbox.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const videoEl = document.getElementById("webcam-video");
  const canvasEl = document.getElementById("output-canvas");
  const btnStartCam = document.getElementById("btn-start-camera");
  const btnStopCam = document.getElementById("btn-stop-camera");
  const btnTestAlert = document.getElementById("btn-test-alert");
  const btnQrModal = document.getElementById("btn-qr-modal");
  const btnSettingsModal = document.getElementById("btn-settings-modal");
  const btnExportCsv = document.getElementById("btn-export-csv");
  const btnResetTrip = document.getElementById("btn-reset-trip");

  // Status Overlays & Badges
  const heroBadge = document.getElementById("hud-hero-badge");
  const strobeOverlay = document.getElementById("emergency-strobe");
  const phoneClientCountEl = document.getElementById("phone-client-count");
  const serverStatusDot = document.getElementById("server-status-dot");
  const serverStatusText = document.getElementById("server-status-text");

  // Telemetry Elements
  const earValEl = document.getElementById("ear-val");
  const marValEl = document.getElementById("mar-val");
  const earBarEl = document.getElementById("ear-bar-fill");
  const marBarEl = document.getElementById("mar-bar-fill");
  const statYawnsEl = document.getElementById("stat-yawns");
  const statMicrosleepsEl = document.getElementById("stat-microsleeps");
  const statDistractionsEl = document.getElementById("stat-distractions");
  const statBlinksEl = document.getElementById("stat-blinks");

  // Modals
  const qrModal = document.getElementById("qr-modal");
  const settingsModal = document.getElementById("settings-modal");
  const snapshotModal = document.getElementById("snapshot-modal");
  const snapshotImg = document.getElementById("snapshot-modal-img");
  const smsModal = document.getElementById("sms-modal");
  const flowchartModal = document.getElementById("flowchart-modal");

  // Settings inputs
  const earSlider = document.getElementById("cfg-ear-thresh");
  const marSlider = document.getElementById("cfg-mar-thresh");
  const earSliderVal = document.getElementById("cfg-ear-val");
  const marSliderVal = document.getElementById("cfg-mar-val");
  const soundToggle = document.getElementById("cfg-sound-toggle");
  const voiceToggle = document.getElementById("cfg-voice-toggle");
  const chkShowMesh = document.getElementById("chk-show-mesh");

  // Tier 4 Channel Elements
  const badgeChCompanion = document.getElementById("badge-ch-companion");
  const badgeChTelegram = document.getElementById("badge-ch-telegram");
  const badgeChTwilio = document.getElementById("badge-ch-twilio");
  const badgeChSms = document.getElementById("badge-ch-sms");
  const lblChTelegramChat = document.getElementById("lbl-ch-telegram-chat");
  const lblChTwilioMode = document.getElementById("lbl-ch-twilio-mode");
  const cardSmsCount = document.getElementById("card-sms-count");
  const hudSmsCount = document.getElementById("hud-sms-count");
  const tier4TerminalLogs = document.getElementById("tier4-terminal-logs");
  const tier4TerminalStatus = document.getElementById("tier4-terminal-status");

  // 1. Initialize Charts & Vision Engine
  window.dashboardCharts.init("telemetry-chart");
  window.visionEngine.init(videoEl, canvasEl);

  // 2. Setup Vision Callbacks
  window.visionEngine.onTelemetryUpdate = (data) => {
    // Update Telemetry Display
    earValEl.textContent = data.ear.toFixed(2);
    marValEl.textContent = data.mar.toFixed(2);

    // Update Progress Bars
    earBarEl.style.width = `${Math.min(100, data.ear * 250)}%`;
    marBarEl.style.width = `${Math.min(100, data.mar * 120)}%`;

    // Update Stat Counters
    statYawnsEl.textContent = data.totalYawns;
    statMicrosleepsEl.textContent = data.totalMicrosleeps;
    if (statDistractionsEl) statDistractionsEl.textContent = data.totalDistractions || 0;
    statBlinksEl.textContent = data.blinkCount;

    // Update Circular Safety Score
    window.dashboardCharts.updateSafetyScoreRing(data.safetyScore);

    // Update Real-Time Chart
    window.dashboardCharts.updateTelemetry(data.ear, data.mar);

    // Update Hero Status Badge
    updateStatusBadge(data.status);

    // Stream Telemetry to Paired Phones over WebSocket (throttle ~10fps)
    if (Math.random() < 0.3) {
      window.socketClient.sendTelemetry(data);
    }
  };

  // Alert Trigger: Local Cabin Alarm (Tier 3) -> REST API Cloud Dispatch (Tier 4)
  window.visionEngine.onAlertTrigger = async (alert) => {
    // 1. Trigger Cabin Audio Siren & Voice Warning (Tier 3 Cockpit HUD)
    if (alert.type === "DROWSINESS" || alert.severity === "critical") {
      window.audioEngine.startEmergencySiren();
      window.audioEngine.speakAlert("Warning! Driver Drowsiness Detected! Wake up!");
      strobeOverlay.className = "emergency-hud-strobe active-critical";
    } else if (alert.type === "DISTRACTION") {
      window.audioEngine.playBeep(920, 0.4, "sawtooth");
      window.audioEngine.speakAlert("Attention! Driver Distraction Detected! Keep eyes on the road!");
      strobeOverlay.className = "emergency-hud-strobe active-warning";
    } else {
      window.audioEngine.playYawnWarningChime();
      window.audioEngine.speakAlert("Attention! Frequent yawning detected. Please consider taking a break.");
      strobeOverlay.className = "emergency-hud-strobe active-warning";
    }

    // 2. Dispatch via REST API Cloud Dispatch (Tier 3 -> Tier 4)
    await dispatchTier4Alert(alert, false);

    // 3. Add to local Incident Table
    addIncidentToTable({
      id: `inc_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: alert.type,
      title: alert.title,
      severity: alert.severity,
      metrics: alert.metrics,
      snapshot: alert.image,
    });
  };

  window.visionEngine.onAlarmStop = (type) => {
    window.audioEngine.stopEmergencySiren();
    strobeOverlay.className = "emergency-hud-strobe";
  };

  function updateStatusBadge(status) {
    heroBadge.className = "status-badge-hero";
    if (status === "CRITICAL_DROWSINESS") {
      heroBadge.classList.add("drowsy");
      heroBadge.textContent = "🚨 CRITICAL: DROWSINESS / MICROSLEEP";
    } else if (status === "YAWNING_WARNING") {
      heroBadge.classList.add("yawn");
      heroBadge.textContent = "🥱 WARNING: YAWNING / FATIGUE";
    } else if (status === "DISTRACTION_WARNING") {
      heroBadge.classList.add("yawn");
      heroBadge.textContent = "👀 WARNING: DRIVER DISTRACTION / LOOKING AWAY";
    } else if (status === "MILD_DROWSY") {
      heroBadge.classList.add("yawn");
      heroBadge.textContent = "⚠️ MILD DROWSINESS DETECTED";
    } else if (status === "FATIGUE_ADVISORY") {
      heroBadge.classList.add("yawn");
      heroBadge.textContent = "☕ FATIGUE ADVISORY: TAKE A BREAK";
    } else if (status === "NO_FACE") {
      heroBadge.textContent = "🔍 NO DRIVER DETECTED";
    } else {
      heroBadge.textContent = "🛡️ DRIVER ALERT & SAFE";
    }
  }

  // ==========================================
  // TIER 3 -> TIER 4: REST API CLOUD DISPATCH
  // ==========================================
  async function dispatchTier4Alert(alertData, force = false) {
    appendTerminalLine("REST CLOUD DISPATCH", `Triggering Tier 4 fan-out for: ${alertData.title}`, "tag-rest");
    if (tier4TerminalStatus) {
      tier4TerminalStatus.textContent = "Dispatching...";
      tier4TerminalStatus.style.color = "#00f2fe";
    }

    try {
      // 1. REST API Cloud Dispatch (Tier 3 -> Tier 4 in flowchart)
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_type: alertData.type || alertData.alert_type || "FATIGUE",
          title: alertData.title,
          message: alertData.message,
          severity: alertData.severity || "warning",
          metrics: alertData.metrics || {},
          image_base64: alertData.image || null,
          force: force,
        }),
      });

      const data = await res.json();
      const results = data.tier4_dispatch || {};

      // 2. Render Results in Live Terminal
      renderDispatchResults(results, alertData.title);

      if (tier4TerminalStatus) {
        tier4TerminalStatus.textContent = "Fan-out Delivered";
        tier4TerminalStatus.style.color = "#34d399";
        setTimeout(() => {
          tier4TerminalStatus.textContent = "Armed & Listening";
        }, 4000);
      }

      // Refresh Tier 4 Badges & SMS counts
      loadTier4Status();

      return results;
    } catch (err) {
      console.warn("REST API Cloud Dispatch error:", err);
      appendTerminalLine("ERROR", `Dispatch failed: ${err.message}`, "tag-err");
      if (tier4TerminalStatus) {
        tier4TerminalStatus.textContent = "Dispatch Error";
        tier4TerminalStatus.style.color = "#f87171";
      }
    }
  }

  function renderDispatchResults(results, title) {
    const timeStr = new Date().toLocaleTimeString();

    // Channel 1: Smartphone Companion
    if (results.smartphone_companion) {
      const sc = results.smartphone_companion;
      const tagClass = sc.connected_clients > 0 ? "tag-ok" : "tag-warn";
      appendTerminalLine(
        "PHONE COMPANION",
        `${sc.details} (Vibration, Siren & Strobe sent)`,
        tagClass
      );
    }

    // Channel 2: Telegram Bot API
    if (results.telegram) {
      const tg = results.telegram;
      const tagClass = tg.status === "SENT" ? "tag-ok" : tg.status === "DISABLED" ? "tag-warn" : "tag-err";
      appendTerminalLine("TELEGRAM BOT", `${tg.details || tg.status}`, tagClass);
    }

    // Channel 3: Twilio REST API
    if (results.twilio) {
      const tw = results.twilio;
      const tagClass = tw.status === "SENT" ? "tag-ok" : tw.status === "DISABLED" ? "tag-warn" : "tag-err";
      appendTerminalLine("TWILIO REST", `${tw.details || tw.status}`, tagClass);
    }

    // Channel 4: SMS Dispatcher
    if (results.sms) {
      const sms = results.sms;
      const tagClass = (sms.status === "SENT" || sms.status === "SIMULATED") ? "tag-ok" : sms.status === "DISABLED" ? "tag-warn" : "tag-err";
      appendTerminalLine("SMS DISPATCH", `${sms.details || sms.status}`, tagClass);
    }
  }

  function appendTerminalLine(tag, message, tagClass = "tag-ok") {
    if (!tier4TerminalLogs) return;
    const timeStr = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = "terminal-line";
    line.innerHTML = `
      <span class="t-time">[${timeStr}]</span>
      <span class="t-tag ${tagClass}">${tag}</span>
      <span>${escapeHtml(message)}</span>
    `;
    tier4TerminalLogs.appendChild(line);
    tier4TerminalLogs.scrollTop = tier4TerminalLogs.scrollHeight;

    // Limit to 50 lines in terminal
    while (tier4TerminalLogs.children.length > 50) {
      tier4TerminalLogs.removeChild(tier4TerminalLogs.children[0]);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Handle incoming dispatch broadcast over WebSocket
  window.socketClient.on("onAlert", (msg) => {
    // If received from another device/source, log in terminal
    if (msg.title && !msg.title.includes("PONG")) {
      appendTerminalLine("INCOMING EVENT", `${msg.title}: ${msg.message || ""}`, "tag-rest");
    }
  });

  // 3. Connect to WebSocket Server
  window.socketClient.on("onConnect", () => {
    serverStatusDot.style.backgroundColor = "#10b981";
    serverStatusText.textContent = "Server Online";
    loadSystemInfo();
    loadIncidents();
    loadTier4Status();
  });

  window.socketClient.on("onDisconnect", () => {
    serverStatusDot.style.backgroundColor = "#ef4444";
    serverStatusText.textContent = "Offline / Reconnecting";
  });

  window.socketClient.connect();

  // 4. Camera Controls
  btnStartCam.addEventListener("click", async () => {
    window.audioEngine.init(); // Unlock Web Audio
    try {
      btnStartCam.disabled = true;
      btnStartCam.textContent = "Starting Camera...";
      await window.visionEngine.startCamera();
      btnStartCam.style.display = "none";
      btnStopCam.style.display = "inline-flex";
    } catch (err) {
      alert("Could not access camera: " + err.message);
      btnStartCam.disabled = false;
      btnStartCam.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg> Start Driver Cam`;
    }
  });

  btnStopCam.addEventListener("click", () => {
    window.visionEngine.stopCamera();
    window.visionEngine.onAlarmStop();
    btnStartCam.style.display = "inline-flex";
    btnStartCam.disabled = false;
    btnStartCam.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg> Start Driver Cam`;
    btnStopCam.style.display = "none";
    updateStatusBadge("NO_FACE");
  });

  // 5. Test Alert Button (Simulate full pipeline)
  btnTestAlert.addEventListener("click", async () => {
    window.audioEngine.init();
    const alertPayload = {
      type: "DROWSINESS",
      title: "🚨 SIMULATED SLEEP ALERT",
      message: "Test alert triggered! Signals dispatched via REST API Cloud Dispatch to all Tier 4 channels.",
      severity: "critical",
      metrics: { ear: 0.14, mar: 0.22, yawns: 1, microsleeps: 1 },
      image: window.visionEngine.captureSnapshot(),
    };

    // Trigger local siren
    window.audioEngine.startEmergencySiren();
    window.audioEngine.speakAlert("Warning! Driver Drowsiness Detected! Wake up!");
    strobeOverlay.className = "emergency-hud-strobe active-critical";

    // Trigger cloud dispatch with force=true
    await dispatchTier4Alert(alertPayload, true);

    setTimeout(() => {
      window.visionEngine.onAlarmStop("DROWSINESS");
    }, 4000);
  });

  // Test All 4 Channels CTA Button in Tier 4 Hub
  const btnTestTier4All = document.getElementById("btn-test-tier4-all");
  if (btnTestTier4All) {
    btnTestTier4All.addEventListener("click", async () => {
      btnTestTier4All.disabled = true;
      btnTestTier4All.innerHTML = `<span class="status-dot pulsing"></span> Dispatching to 4 Channels...`;
      await dispatchTier4Alert({
        type: "TEST_TIER4",
        title: "⚡ TIER 4 MULTI-CHANNEL CLOUD TEST",
        message: "Simultaneous test across Smartphone Companion, Telegram Bot, Twilio REST & SMS.",
        severity: "critical",
        metrics: { ear: 0.15, mar: 0.55 },
        image: window.visionEngine.captureSnapshot(),
      }, true);
      btnTestTier4All.disabled = false;
      btnTestTier4All.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Test All 4 Channels (Cloud Dispatch)`;
    });
  }

  // 6. Reset Trip
  btnResetTrip.addEventListener("click", async () => {
    if (confirm("Reset current trip metrics and yawn count?")) {
      window.visionEngine.resetStats();
      await fetch("/api/reset_trip", { method: "POST" });
      loadIncidents();
    }
  });

  // 7. QR Code Mobile Companion Generator
  let systemInfoData = null;

  async function loadSystemInfo() {
    try {
      const res = await fetch("/api/system_info");
      systemInfoData = await res.json();

      const ipSelect = document.getElementById("qr-ip-select");
      if (ipSelect && systemInfoData.all_ips) {
        ipSelect.innerHTML = "";
        systemInfoData.all_ips.forEach((ip) => {
          const opt = document.createElement("option");
          opt.value = ip;
          opt.textContent = `${ip} ${ip === systemInfoData.local_ip ? "(Recommended)" : ""}`;
          ipSelect.appendChild(opt);
        });

        ipSelect.onchange = () => {
          updateQrForIp(ipSelect.value);
        };
      }

      updateQrForIp(systemInfoData.local_ip);

      if (phoneClientCountEl) {
        phoneClientCountEl.textContent = `${systemInfoData.active_phone_clients} Phone(s) Connected`;
      }
    } catch (e) {
      console.warn("Could not load system info:", e);
    }
  }

  function updateQrForIp(ip) {
    const port = systemInfoData?.port || 8000;
    const companionUrl = `http://${ip}:${port}/companion`;
    document.getElementById("qr-url-text").value = companionUrl;

    const qrCanvas = document.getElementById("qr-code-canvas");
    if (qrCanvas && window.QRious) {
      new QRious({
        element: qrCanvas,
        value: companionUrl,
        size: 170,
        background: "#ffffff",
        foreground: "#07090e",
        level: "H",
      });
    }
  }

  // Copy Companion URL Button
  const btnCopyQr = document.getElementById("btn-copy-qr-url");
  if (btnCopyQr) {
    btnCopyQr.addEventListener("click", () => {
      const urlInput = document.getElementById("qr-url-text");
      urlInput.select();
      navigator.clipboard.writeText(urlInput.value);
      btnCopyQr.textContent = "Copied!";
      setTimeout(() => (btnCopyQr.textContent = "Copy Link"), 2000);
    });
  }

  // 8. Tier 4 Channels Status Loader
  async function loadTier4Status() {
    try {
      const res = await fetch("/api/tier4/status");
      const data = await res.json();
      const ch = data.channels || {};

      // Smartphone Companion
      if (ch.smartphone_companion) {
        const count = ch.smartphone_companion.connected_devices || 0;
        if (badgeChCompanion) {
          badgeChCompanion.textContent = `${count} Paired`;
          badgeChCompanion.className = count > 0 ? "tier4-badge badge-online" : "tier4-badge badge-ready";
        }
        if (phoneClientCountEl) {
          phoneClientCountEl.textContent = `${count} Phone(s) Connected`;
        }
      }

      // Telegram Bot API
      if (ch.telegram) {
        if (badgeChTelegram) {
          badgeChTelegram.textContent = ch.telegram.enabled ? (ch.telegram.configured ? "Ready" : "Needs Token") : "Disabled";
          badgeChTelegram.className = ch.telegram.enabled && ch.telegram.configured ? "tier4-badge badge-ready" : "tier4-badge badge-disabled";
        }
        if (lblChTelegramChat) {
          lblChTelegramChat.textContent = ch.telegram.chat_id_masked ? `Chat: ${ch.telegram.chat_id_masked}` : "Chat: Not Set";
        }
      }

      // Twilio REST API
      if (ch.twilio) {
        if (badgeChTwilio) {
          badgeChTwilio.textContent = ch.twilio.enabled ? (ch.twilio.configured ? "Ready" : "Needs SID") : "Disabled";
          badgeChTwilio.className = ch.twilio.enabled && ch.twilio.configured ? "tier4-badge badge-ready" : "tier4-badge badge-disabled";
        }
        if (lblChTwilioMode) {
          lblChTwilioMode.textContent = `Mode: ${(ch.twilio.channel || "whatsapp").toUpperCase()}`;
        }
      }

      // SMS Dispatcher
      if (ch.sms) {
        if (badgeChSms) {
          const prov = ch.sms.provider === "cellular_simulator" ? "Cellular Active" : "Gateway Active";
          badgeChSms.textContent = ch.sms.enabled ? prov : "Disabled";
          badgeChSms.className = ch.sms.enabled ? "tier4-badge badge-online" : "tier4-badge badge-disabled";
        }
        const totalSms = ch.sms.total_sent || data.sms_inbox_count || 0;
        if (cardSmsCount) cardSmsCount.textContent = totalSms;
        if (hudSmsCount) hudSmsCount.textContent = totalSms;
      }
    } catch (e) {
      console.warn("Could not load Tier 4 status:", e);
    }
  }

  // 9. Individual Channel Quick Test Handlers
  async function testChannel(channelName, btn) {
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "Testing...";
    try {
      const res = await fetch(`/api/test/channel/${channelName}`, { method: "POST" });
      const data = await res.json();
      const resStatus = data.result?.status || data.status;
      appendTerminalLine(
        channelName.toUpperCase(),
        data.result?.message || `Test completed (${resStatus})`,
        resStatus === "SENT" || resStatus === "DELIVERED" || resStatus === "SIMULATED" ? "tag-ok" : "tag-warn"
      );
      loadTier4Status();
    } catch (e) {
      appendTerminalLine(channelName.toUpperCase(), `Test failed: ${e.message}`, "tag-err");
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }

  const btnTestChCompanion = document.getElementById("btn-test-ch-companion");
  if (btnTestChCompanion) {
    btnTestChCompanion.addEventListener("click", () => testChannel("companion", btnTestChCompanion));
  }

  const btnTestChTelegram = document.getElementById("btn-test-ch-telegram");
  if (btnTestChTelegram) {
    btnTestChTelegram.addEventListener("click", () => testChannel("telegram", btnTestChTelegram));
  }

  const btnTestChTwilio = document.getElementById("btn-test-ch-twilio");
  if (btnTestChTwilio) {
    btnTestChTwilio.addEventListener("click", () => testChannel("twilio", btnTestChTwilio));
  }

  const btnTestChSms = document.getElementById("btn-test-ch-sms");
  if (btnTestChSms) {
    btnTestChSms.addEventListener("click", () => testChannel("sms", btnTestChSms));
  }

  // Modal test buttons inside Settings Modal
  const btnModalTestTelegram = document.getElementById("btn-modal-test-telegram");
  if (btnModalTestTelegram) {
    btnModalTestTelegram.addEventListener("click", () => testChannel("telegram", btnModalTestTelegram));
  }
  const btnModalTestTwilio = document.getElementById("btn-modal-test-twilio");
  if (btnModalTestTwilio) {
    btnModalTestTwilio.addEventListener("click", () => testChannel("twilio", btnModalTestTwilio));
  }
  const btnModalTestSms = document.getElementById("btn-modal-test-sms");
  if (btnModalTestSms) {
    btnModalTestSms.addEventListener("click", () => testChannel("sms", btnModalTestSms));
  }

  // Pair Phone QR button inside Channel 1 card
  const btnPairChQr = document.getElementById("btn-pair-ch-qr");
  if (btnPairChQr) {
    btnPairChQr.addEventListener("click", () => btnQrModal.click());
  }

  // Configure Channels button inside Tier 4 Hub
  const btnSettingsTier4Cta = document.getElementById("btn-settings-tier4-cta");
  if (btnSettingsTier4Cta) {
    btnSettingsTier4Cta.addEventListener("click", () => btnSettingsModal.click());
  }

  // 10. SMS Inbox Modal Logic
  const btnSmsInboxOpen = document.getElementById("btn-sms-inbox-open");
  const btnViewSmsInbox = document.getElementById("btn-view-sms-inbox");
  const smsInboxTbody = document.getElementById("sms-inbox-tbody");
  const btnClearSmsInbox = document.getElementById("btn-clear-sms-inbox");

  async function openSmsInbox() {
    await loadSmsInbox();
    if (smsModal) smsModal.classList.add("open");
  }

  if (btnSmsInboxOpen) btnSmsInboxOpen.addEventListener("click", openSmsInbox);
  if (btnViewSmsInbox) btnViewSmsInbox.addEventListener("click", openSmsInbox);

  async function loadSmsInbox() {
    if (!smsInboxTbody) return;
    try {
      const res = await fetch("/api/sms/inbox");
      const data = await res.json();
      smsInboxTbody.innerHTML = "";

      if (data.messages && data.messages.length > 0) {
        data.messages.forEach((msg) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>${msg.timestamp}</strong></td>
            <td><code style="color:#00f2fe;">${escapeHtml(msg.to)}</code></td>
            <td style="font-size:0.75rem;">${escapeHtml(msg.message)}</td>
            <td><span style="font-size:0.7rem;color:#94a3b8;">${escapeHtml(msg.provider || "Cellular Gateway")}</span></td>
            <td><span class="tier4-badge badge-online">DELIVERED</span></td>
          `;
          smsInboxTbody.appendChild(tr);
        });
      } else {
        smsInboxTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No SMS alerts recorded yet. Click "Test SMS" to dispatch a test signal.</td></tr>`;
      }
    } catch (e) {
      console.warn("Could not load SMS inbox:", e);
    }
  }

  if (btnClearSmsInbox) {
    btnClearSmsInbox.addEventListener("click", async () => {
      await fetch("/api/sms/clear", { method: "POST" });
      loadSmsInbox();
      loadTier4Status();
    });
  }

  // 11. Architecture Flowchart Modal
  const btnFlowchartModal = document.getElementById("btn-flowchart-modal");
  if (btnFlowchartModal && flowchartModal) {
    btnFlowchartModal.addEventListener("click", () => {
      flowchartModal.classList.add("open");
    });
  }

  // 12. Modals Management
  btnQrModal.addEventListener("click", () => {
    loadSystemInfo();
    qrModal.classList.add("open");
  });

  btnSettingsModal.addEventListener("click", () => {
    loadConfig();
    settingsModal.classList.add("open");
  });

  function closeAllModals() {
    [qrModal, settingsModal, snapshotModal, smsModal, flowchartModal].forEach((m) => {
      if (m) m.classList.remove("open");
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".close-modal")) {
      closeAllModals();
    }
  });

  [qrModal, settingsModal, snapshotModal, smsModal, flowchartModal].forEach((modal) => {
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeAllModals();
        }
      });
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllModals();
    }
  });

  // 13. Sensitivity Settings Controls
  earSlider.addEventListener("input", (e) => {
    earSliderVal.textContent = e.target.value;
    window.visionEngine.earThreshold = parseFloat(e.target.value);
    const lbl = document.getElementById("lbl-ear-thresh");
    if (lbl) lbl.textContent = `Thresh: < ${e.target.value}`;
  });

  marSlider.addEventListener("input", (e) => {
    marSliderVal.textContent = e.target.value;
    window.visionEngine.marThreshold = parseFloat(e.target.value);
    const lbl = document.getElementById("lbl-mar-thresh");
    if (lbl) lbl.textContent = `Thresh: > ${e.target.value}`;
  });

  soundToggle.addEventListener("change", (e) => {
    window.audioEngine.soundEnabled = e.target.checked;
  });

  voiceToggle.addEventListener("change", (e) => {
    window.audioEngine.voiceEnabled = e.target.checked;
  });

  chkShowMesh.addEventListener("change", (e) => {
    window.visionEngine.showMesh = e.target.checked;
  });

  // SMS Provider switch
  const cfgSmsProvider = document.getElementById("cfg-sms-provider");
  const cfgSmsCustomUrl = document.getElementById("cfg-sms-custom-url");
  if (cfgSmsProvider && cfgSmsCustomUrl) {
    cfgSmsProvider.addEventListener("change", (e) => {
      cfgSmsCustomUrl.style.display = e.target.value === "generic_http" ? "block" : "none";
    });
  }

  // Save Settings to Backend
  const formSettings = document.getElementById("form-settings");
  if (formSettings) {
    formSettings.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        ear_threshold: parseFloat(earSlider.value),
        mar_threshold: parseFloat(marSlider.value),
        telegram: {
          enabled: document.getElementById("cfg-tg-enabled").checked,
          bot_token: document.getElementById("cfg-tg-token").value,
          chat_id: document.getElementById("cfg-tg-chat").value,
        },
        twilio: {
          enabled: document.getElementById("cfg-tw-enabled").checked,
          account_sid: document.getElementById("cfg-tw-sid").value,
          auth_token: document.getElementById("cfg-tw-token").value,
          from_number: document.getElementById("cfg-tw-from").value,
          to_number: document.getElementById("cfg-tw-to").value,
          channel: document.getElementById("cfg-tw-channel").value,
        },
        sms: {
          enabled: document.getElementById("cfg-sms-enabled").checked,
          provider: document.getElementById("cfg-sms-provider").value,
          to_number: document.getElementById("cfg-sms-to").value,
          from_number: document.getElementById("cfg-sms-from").value,
          api_key: document.getElementById("cfg-sms-key").value,
          custom_url: document.getElementById("cfg-sms-custom-url").value,
        },
      };

      try {
        await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        alert("Settings saved successfully!");
        settingsModal.classList.remove("open");
        loadTier4Status();
      } catch (err) {
        alert("Failed to save settings: " + err.message);
      }
    });
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      const cfg = await res.json();
      if (cfg.detector) {
        earSlider.value = cfg.detector.ear_threshold;
        earSliderVal.textContent = cfg.detector.ear_threshold;
        marSlider.value = cfg.detector.mar_threshold;
        marSliderVal.textContent = cfg.detector.mar_threshold;
        window.visionEngine.earThreshold = cfg.detector.ear_threshold;
        window.visionEngine.marThreshold = cfg.detector.mar_threshold;
      }
      if (cfg.notifier && cfg.notifier.telegram) {
        document.getElementById("cfg-tg-enabled").checked = cfg.notifier.telegram.enabled;
        document.getElementById("cfg-tg-token").value = cfg.notifier.telegram.bot_token || "";
        document.getElementById("cfg-tg-chat").value = cfg.notifier.telegram.chat_id || "";
      }
      if (cfg.notifier && cfg.notifier.twilio) {
        document.getElementById("cfg-tw-enabled").checked = cfg.notifier.twilio.enabled;
        document.getElementById("cfg-tw-sid").value = cfg.notifier.twilio.account_sid || "";
        document.getElementById("cfg-tw-token").value = cfg.notifier.twilio.auth_token || "";
        document.getElementById("cfg-tw-from").value = cfg.notifier.twilio.from_number || "";
        document.getElementById("cfg-tw-to").value = cfg.notifier.twilio.to_number || "";
        document.getElementById("cfg-tw-channel").value = cfg.notifier.twilio.channel || "whatsapp";
      }
      if (cfg.notifier && cfg.notifier.sms) {
        document.getElementById("cfg-sms-enabled").checked = cfg.notifier.sms.enabled !== false;
        document.getElementById("cfg-sms-provider").value = cfg.notifier.sms.provider || "cellular_simulator";
        document.getElementById("cfg-sms-to").value = cfg.notifier.sms.to_number || "+1234567890";
        document.getElementById("cfg-sms-from").value = cfg.notifier.sms.from_number || "DriverGuard";
        document.getElementById("cfg-sms-key").value = cfg.notifier.sms.api_key || "";
        document.getElementById("cfg-sms-custom-url").value = cfg.notifier.sms.custom_url || "";
        if (cfgSmsCustomUrl) {
          cfgSmsCustomUrl.style.display = cfg.notifier.sms.provider === "generic_http" ? "block" : "none";
        }
      }
    } catch (e) {
      console.warn("Could not load backend config:", e);
    }
  }

  // 14. Incident Blackbox Table
  const tableBody = document.getElementById("blackbox-tbody");

  function addIncidentToTable(inc) {
    const tr = document.createElement("tr");
    const isDrowsy = inc.type === "DROWSINESS";
    const badgeClass = isDrowsy ? "table-badge drowsy" : "table-badge yawn";
    const snapHtml = inc.snapshot
      ? `<img src="${inc.snapshot}" class="thumb-preview" alt="Snapshot" onclick="showSnapshot('${inc.snapshot}')">`
      : `<span style="color:#64748b">—</span>`;

    tr.innerHTML = `
      <td><strong>${inc.timestamp}</strong></td>
      <td><span class="${badgeClass}">${inc.type}</span></td>
      <td>${inc.title}</td>
      <td>${inc.metrics ? `EAR: ${inc.metrics.ear || "-"} / MAR: ${inc.metrics.mar || "-"}` : "-"}</td>
      <td>${snapHtml}</td>
    `;
    tableBody.prepend(tr);
  }

  async function loadIncidents() {
    try {
      const res = await fetch("/api/incidents");
      const data = await res.json();
      tableBody.innerHTML = "";
      if (data.incidents && data.incidents.length > 0) {
        data.incidents.forEach((inc) => addIncidentToTable(inc));
      } else {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No fatigue incidents recorded on this trip. Safe driving!</td></tr>`;
      }
    } catch (e) {
      console.warn("Could not load incident logs:", e);
    }
  }

  window.showSnapshot = (src) => {
    snapshotImg.src = src;
    snapshotModal.classList.add("open");
  };

  btnExportCsv.addEventListener("click", () => {
    window.open("/api/incidents/export?format=csv", "_blank");
  });

  // Periodically refresh Tier 4 connectivity status
  setInterval(loadTier4Status, 8000);
});
