/**
 * Mobile Phone Companion Controller
 * Handles smartphone vibration, loud phone siren, live captured incident snapshots, Wake Lock, and live telemetry sync.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const heroCard = document.getElementById("hero-card");
  const heroIcon = document.getElementById("hero-icon");
  const heroTitle = document.getElementById("hero-title");
  const heroSubtitle = document.getElementById("hero-subtitle");
  const strobeOverlay = document.getElementById("mobile-strobe");
  const alarmBar = document.getElementById("alarm-bar");
  const connDot = document.getElementById("conn-dot");
  const connText = document.getElementById("conn-text");
  const wakeLockBanner = document.getElementById("wakelock-banner");
  const btnEnableAudio = document.getElementById("btn-enable-audio");

  // Live Snapshot Elements
  const liveSnapCard = document.getElementById("live-snapshot-card");
  const liveSnapImg = document.getElementById("incident-live-img");
  const snapTypeBadge = document.getElementById("snap-type-badge");
  const snapTimeEl = document.getElementById("snap-time");
  const snapOverlayDesc = document.getElementById("snap-overlay-desc");

  // Telemetry Elements
  const valScore = document.getElementById("stat-score");
  const valYawns = document.getElementById("stat-yawns");
  const valMicrosleeps = document.getElementById("stat-microsleeps");
  const valDistractions = document.getElementById("stat-distractions");

  let wakeLock = null;
  let isAlarmActive = false;
  let audioUnlocked = false;

  // 1. Initialize Audio Engine & Unlock on first touch
  function unlockAudio() {
    if (window.audioEngine) {
      window.audioEngine.init();
      audioUnlocked = true;
      if (wakeLockBanner) wakeLockBanner.style.display = "none";
      requestWakeLock();
    }
  }

  if (btnEnableAudio) {
    btnEnableAudio.addEventListener("click", () => {
      unlockAudio();
      window.audioEngine.playBeep(880, 0.2);
    });
  }

  document.body.addEventListener("touchstart", unlockAudio, { once: true });
  document.body.addEventListener("click", unlockAudio, { once: true });

  // 2. Request Screen Wake Lock (keeps phone screen on in car)
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        console.log("Screen WakeLock active");
      }
    } catch (err) {
      console.warn("WakeLock error:", err);
    }
  }

  // 3. Connect to WebSocket
  window.socketClient.on("onConnect", () => {
    connDot.classList.remove("disconnected");
    connText.textContent = "Live Synced";
  });

  window.socketClient.on("onDisconnect", () => {
    connDot.classList.add("disconnected");
    connText.textContent = "Reconnecting...";
  });

  window.socketClient.connect();

  // 4. Handle Live Telemetry Sync from driver camera
  window.socketClient.on("onTelemetrySync", (data) => {
    if (!data) return;

    if (valScore) valScore.textContent = data.safetyScore || 100;
    if (valYawns) valYawns.textContent = data.totalYawns || 0;
    if (valMicrosleeps) valMicrosleeps.textContent = data.totalMicrosleeps || 0;
    if (valDistractions) valDistractions.textContent = data.totalDistractions || 0;

    // If no active alarm, update hero card dynamically
    if (!isAlarmActive) {
      updateNormalState(data);
    }
  });

  function updateNormalState(data) {
    heroCard.className = "hero-status-card";
    if (data.status === "ALERT_NORMAL") {
      heroIcon.textContent = "🛡️";
      heroTitle.textContent = "DRIVER SAFE";
      heroSubtitle.textContent = "Driver is focused and attentive. Monitoring live.";
    } else if (data.status === "MILD_DROWSY") {
      heroIcon.textContent = "⚠️";
      heroTitle.textContent = "MILD DROWSINESS";
      heroSubtitle.textContent = "Eyes fluttering / heavy eyelids detected.";
    } else if (data.status === "FATIGUE_ADVISORY") {
      heroIcon.textContent = "☕";
      heroTitle.textContent = "FATIGUE ADVISORY";
      heroSubtitle.textContent = "Multiple yawns detected. Consider taking a break.";
    } else if (data.status === "DISTRACTION_WARNING") {
      heroIcon.textContent = "👀";
      heroTitle.textContent = "DISTRACTION WARNING";
      heroSubtitle.textContent = "Driver head turned away or looking down.";
    }
  }

  // 5. Handle Live Incoming ALERTS (Drowsiness, Yawn, Distraction)
  window.socketClient.on("onAlert", (alert) => {
    triggerMobileAlert(alert);
  });

  function triggerMobileAlert(alert) {
    isAlarmActive = true;
    const alertType = alert.alert_type || alert.type || "ALERT";
    const isCritical = alertType === "DROWSINESS" || alert.severity === "critical";
    const isYawn = alertType === "YAWNING";
    const isDistract = alertType === "DISTRACTION";

    // 1. Update Hero UI
    let modeClass = "hero-status-card";
    let icon = "🚨";
    let strobeClass = "mobile-strobe-overlay";

    if (isCritical) {
      modeClass += " drowsy-mode";
      icon = "😴";
      strobeClass += " active-drowsy";
    } else if (isYawn) {
      modeClass += " yawn-mode";
      icon = "🥱";
      strobeClass += " active-yawn";
    } else if (isDistract) {
      modeClass += " distract-mode";
      icon = "👀";
      strobeClass += " active-distract";
    }

    heroCard.className = modeClass;
    heroIcon.textContent = icon;
    heroTitle.textContent = alert.title || `${alertType} DETECTED!`;
    heroSubtitle.textContent = alert.message || "Immediate driver attention required!";

    // 2. Fullscreen Strobe Flash
    strobeOverlay.className = strobeClass;

    // 3. Alarm action bar
    if (alarmBar) {
      alarmBar.classList.add("visible");
      alarmBar.textContent = isCritical
        ? "🚨 CRITICAL SLEEP ALARM! TAP TO DISMISS"
        : isDistract
        ? "⚠️ DISTRACTION ALERT! TAP TO DISMISS"
        : "⚠️ FATIGUE YAWN WARNING! TAP TO DISMISS";
    }

    // 4. Render Live Captured Incident Snapshot Image on Phone
    if (alert.image && liveSnapCard && liveSnapImg) {
      liveSnapImg.src = alert.image;
      liveSnapCard.style.display = "block";
      if (snapTypeBadge) snapTypeBadge.textContent = `${alertType} EVIDENCE CAPTURED`;
      if (snapTimeEl) snapTimeEl.textContent = new Date().toLocaleTimeString();
      if (snapOverlayDesc) snapOverlayDesc.textContent = alert.message || alert.title;
    }

    // 5. Hardware Phone Vibration
    if ("vibrate" in navigator) {
      if (isCritical) {
        // Urgent pattern: Vibrate 600ms, pause 150ms, vibrate 600ms, pause 150ms, vibrate 1000ms
        navigator.vibrate([600, 150, 600, 150, 1000]);
      } else if (isDistract) {
        // Double warning pulse
        navigator.vibrate([400, 200, 400, 200, 600]);
      } else {
        // Yawn warning pattern
        navigator.vibrate([300, 200, 300, 200, 400]);
      }
    }

    // 6. Audio Siren & Speech on Phone Speaker
    if (window.audioEngine) {
      if (isCritical) {
        window.audioEngine.startEmergencySiren();
        window.audioEngine.speakAlert("Warning! Driver is falling asleep! Wake up!");
      } else if (isDistract) {
        window.audioEngine.playBeep(920, 0.4, "sawtooth");
        window.audioEngine.speakAlert("Attention! Keep your eyes on the road! Distraction detected!");
      } else {
        window.audioEngine.playYawnWarningChime();
        window.audioEngine.speakAlert("Driver fatigue warning! Yawning detected!");
      }
    }
  }

  // Dismiss Alarm button
  if (alarmBar) {
    alarmBar.addEventListener("click", dismissAlarm);
  }

  function dismissAlarm() {
    isAlarmActive = false;
    if (alarmBar) alarmBar.classList.remove("visible");
    strobeOverlay.className = "mobile-strobe-overlay";
    heroCard.className = "hero-status-card";
    heroIcon.textContent = "🛡️";
    heroTitle.textContent = "DRIVER SAFE";
    heroSubtitle.textContent = "Alarm silenced";

    if (window.audioEngine) {
      window.audioEngine.stopEmergencySiren();
    }
    if ("vibrate" in navigator) {
      navigator.vibrate(0); // Cancel vibration
    }
  }

  // Test Buzz & Snapshot Button
  const btnTestBuzz = document.getElementById("btn-test-buzz");
  if (btnTestBuzz) {
    btnTestBuzz.addEventListener("click", () => {
      unlockAudio();
      triggerMobileAlert({
        alert_type: "DROWSINESS",
        severity: "critical",
        title: "TEST ALARM & SNAPSHOT DISPATCH",
        message: "Mobile vibration, phone siren & live snapshot test successful.",
      });
      setTimeout(dismissAlarm, 5000);
    });
  }

  // SOS Emergency Trigger Button
  const btnSos = document.getElementById("btn-sos-call");
  if (btnSos) {
    btnSos.addEventListener("click", () => {
      unlockAudio();
      window.socketClient.sendAlert({
        type: "SOS_MANUAL",
        title: "SOS EMERGENCY TRIGGERED",
        message: "Driver or passenger pressed emergency SOS button from mobile receiver.",
        severity: "critical",
      });
      triggerMobileAlert({
        alert_type: "DROWSINESS",
        severity: "critical",
        title: "EMERGENCY SOS ACTIVE",
        message: "Signal dispatched to dashboard & emergency contacts.",
      });
    });
  }

  // Tier 4 Mobile SMS Drawer Logic
  const btnViewMobileSms = document.getElementById("btn-view-mobile-sms");
  const mobileSmsDrawer = document.getElementById("mobile-sms-drawer");
  const btnCloseMobileSms = document.getElementById("btn-close-mobile-sms");
  const mobileSmsList = document.getElementById("mobile-sms-list");
  const mobileSmsCount = document.getElementById("mobile-sms-count");
  const tier4DispatchPill = document.getElementById("tier4-dispatch-pill");

  async function loadMobileSms() {
    try {
      const res = await fetch("/api/sms/inbox");
      const data = await res.json();
      if (mobileSmsCount) mobileSmsCount.textContent = data.count || 0;
      if (mobileSmsList) {
        mobileSmsList.innerHTML = "";
        if (data.messages && data.messages.length > 0) {
          data.messages.slice(0, 5).forEach((msg) => {
            const item = document.createElement("div");
            item.style.padding = "6px 8px";
            item.style.marginBottom = "6px";
            item.style.background = "rgba(255,255,255,0.05)";
            item.style.borderRadius = "6px";
            item.innerHTML = `
              <div style="display:flex;justify-content:space-between;color:#00f2fe;font-size:0.68rem;">
                <strong>${msg.from} ➔ ${msg.to}</strong>
                <span>${msg.timestamp.split(" ")[1] || ""}</span>
              </div>
              <div style="margin-top:2px;color:#f8fafc;">${msg.message}</div>
            `;
            mobileSmsList.appendChild(item);
          });
        } else {
          mobileSmsList.innerHTML = `<p style="color:#64748b;text-align:center;padding:10px;">No SMS text alerts dispatched yet.</p>`;
        }
      }
    } catch (e) {
      console.warn("Could not load mobile SMS:", e);
    }
  }

  if (btnViewMobileSms && mobileSmsDrawer) {
    btnViewMobileSms.addEventListener("click", () => {
      loadMobileSms();
      mobileSmsDrawer.style.display = mobileSmsDrawer.style.display === "none" ? "block" : "none";
    });
  }

  if (btnCloseMobileSms && mobileSmsDrawer) {
    btnCloseMobileSms.addEventListener("click", () => {
      mobileSmsDrawer.style.display = "none";
    });
  }

  // Show Tier 4 dispatch banner on alert
  const origTrigger = triggerMobileAlert;
  triggerMobileAlert = function (alert) {
    origTrigger(alert);
    if (tier4DispatchPill) {
      tier4DispatchPill.style.display = "block";
      setTimeout(() => {
        tier4DispatchPill.style.display = "none";
      }, 7000);
    }
    loadMobileSms();
  };

  // Check SMS count periodically
  loadMobileSms();
  setInterval(loadMobileSms, 10000);

  // Return Back to Dashboard / Disconnect Handler
  function handleReturnBack() {
    // 1. Silence any ongoing alarms and vibrations
    dismissAlarm();

    // 2. Disconnect WebSocket
    if (window.socketClient && window.socketClient.disconnect) {
      window.socketClient.disconnect();
    }

    // 3. Release screen wake-lock
    if (wakeLock && wakeLock.release) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }

    // 4. Determine dashboard destination URL
    const isApacheXampp = window.location.pathname.includes("/major/");
    const dashboardUrl = isApacheXampp ? "/major/frontend/index.html" : "/";

    // 5. Navigate back if history exists, or redirect to dashboard
    if (window.history.length > 1 && document.referrer && document.referrer.includes(window.location.host)) {
      window.history.back();
    } else {
      window.location.href = dashboardUrl;
    }
  }

  const btnHeaderBack = document.getElementById("btn-header-back");
  if (btnHeaderBack) {
    btnHeaderBack.addEventListener("click", handleReturnBack);
  }

  const btnMobileReturn = document.getElementById("btn-mobile-return");
  if (btnMobileReturn) {
    btnMobileReturn.addEventListener("click", handleReturnBack);
  }
});

