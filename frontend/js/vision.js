/**
 * Real-Time Facial Landmark & Fatigue Computer Vision Engine
 * Pixel-calibrated Euclidean geometry for high-accuracy Eye Blink tracking, Yawn detection & Distraction.
 */

class VisionEngine {
  constructor() {
    this.videoElement = null;
    this.canvasElement = null;
    this.canvasCtx = null;
    this.faceMesh = null;
    this.camera = null;

    // 468-point Landmark Indices for Eyes (MediaPipe)
    // Left eye: 362 (inner), 263 (outer), top: [385, 386, 387], bottom: [380, 374, 373]
    this.LEFT_EYE_PTS = {
      corner1: 362,
      corner2: 263,
      top1: 385,
      bot1: 380,
      top2: 387,
      bot2: 373,
    };
    // Right eye: 33 (outer), 133 (inner), top: [160, 159, 158], bottom: [144, 145, 153]
    this.RIGHT_EYE_PTS = {
      corner1: 33,
      corner2: 133,
      top1: 160,
      bot1: 144,
      top2: 158,
      bot2: 153,
    };

    // Mouth Indices (Inner Lip Contour for accurate Yawn detection)
    this.MOUTH_INNER_TOP = 13;
    this.MOUTH_INNER_BOT = 14;
    this.MOUTH_TOP_L = 81;
    this.MOUTH_BOT_L = 178;
    this.MOUTH_TOP_R = 311;
    this.MOUTH_BOT_R = 402;
    this.MOUTH_CORNER_L = 61;
    this.MOUTH_CORNER_R = 291;

    // Head Pose Indices
    this.NOSE_TIP = 1;
    this.CHIN = 152;
    this.LEFT_CHEEK = 234;
    this.RIGHT_CHEEK = 454;

    // Detection Thresholds (Pixel-Calibrated)
    this.earThreshold = 0.20;      // < 0.20 in pixel space = Eyes Closed
    this.earConsecFrames = 10;     // ~0.5s closed => Drowsiness / Sleep Alert
    this.marThreshold = 0.48;      // > 0.48 in pixel space = Yawning Wide Open (normal speech is ~0.15-0.25)
    this.marConsecFrames = 8;      // ~0.4s open => Confirmed Yawn
    this.distractConsecFrames = 18; // ~1.0s looking away / looking down at phone

    // Real-Time Tracking Counters
    this.drowsyFrameCount = 0;
    this.yawnFrameCount = 0;
    this.distractFrameCount = 0;
    this.totalYawns = 0;
    this.totalMicrosleeps = 0;
    this.totalDistractions = 0;
    this.blinkCount = 0;
    this.isEyeClosed = false;

    // Visual options
    this.showMesh = true;

    // Alert states
    this.isDrowsyAlertActive = false;
    this.isYawnAlertActive = false;
    this.isDistractAlertActive = false;

    // Callbacks
    this.onTelemetryUpdate = null;
    this.onAlertTrigger = null;
    this.onAlarmStop = null;
  }

  init(videoEl, canvasEl) {
    this.videoElement = videoEl;
    this.canvasElement = canvasEl;
    this.canvasCtx = canvasEl.getContext("2d");

    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.faceMesh.onResults(this.handleResults.bind(this));
  }

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Browser does not support webcam access");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });

    this.videoElement.srcObject = stream;
    await this.videoElement.play();

    this.camera = new Camera(this.videoElement, {
      onFrame: async () => {
        if (this.videoElement.readyState >= 2) {
          await this.faceMesh.send({ image: this.videoElement });
        }
      },
      width: 640,
      height: 480,
    });

    await this.camera.start();
  }

  stopCamera() {
    if (this.camera) {
      this.camera.stop();
    }
    if (this.videoElement && this.videoElement.srcObject) {
      this.videoElement.srcObject.getTracks().forEach((t) => t.stop());
    }
  }

  // Calculate true Euclidean distance in actual pixel dimensions (prevents aspect-ratio distortion)
  distPx(p1, p2, w, h) {
    const dx = (p1.x - p2.x) * w;
    const dy = (p1.y - p2.y) * h;
    return Math.hypot(dx, dy);
  }

  // Calculate Eye Aspect Ratio (EAR) using pixel space
  calculateEyeEAR(landmarks, pts, w, h) {
    try {
      const pCorner1 = landmarks[pts.corner1];
      const pCorner2 = landmarks[pts.corner2];
      const pTop1 = landmarks[pts.top1];
      const pBot1 = landmarks[pts.bot1];
      const pTop2 = landmarks[pts.top2];
      const pBot2 = landmarks[pts.bot2];

      const v1 = this.distPx(pTop1, pBot1, w, h);
      const v2 = this.distPx(pTop2, pBot2, w, h);
      const horiz = this.distPx(pCorner1, pCorner2, w, h);

      if (horiz === 0) return 0;
      return (v1 + v2) / (2.0 * horiz);
    } catch (e) {
      return 0;
    }
  }

  // Calculate Mouth Aspect Ratio (MAR) using pixel space
  calculateMouthMAR(landmarks, w, h) {
    try {
      const topCenter = landmarks[this.MOUTH_INNER_TOP];
      const botCenter = landmarks[this.MOUTH_INNER_BOT];
      const topL = landmarks[this.MOUTH_TOP_L];
      const botL = landmarks[this.MOUTH_BOT_L];
      const topR = landmarks[this.MOUTH_TOP_R];
      const botR = landmarks[this.MOUTH_BOT_R];
      const cornerL = landmarks[this.MOUTH_CORNER_L];
      const cornerR = landmarks[this.MOUTH_CORNER_R];

      const vCenter = this.distPx(topCenter, botCenter, w, h);
      const vL = this.distPx(topL, botL, w, h);
      const vR = this.distPx(topR, botR, w, h);
      const horiz = this.distPx(cornerL, cornerR, w, h);

      if (horiz === 0) return 0;
      // Weighted vertical mouth opening vs width
      const vAvg = (vCenter + (vL + vR) / 2.0) / 2.0;
      return vAvg / horiz;
    } catch (e) {
      return 0;
    }
  }

  // Calculate Head Orientation & Gaze Distraction
  calculateHeadPose(landmarks) {
    try {
      const nose = landmarks[this.NOSE_TIP];
      const chin = landmarks[this.CHIN];
      const leftCheek = landmarks[this.LEFT_CHEEK];
      const rightCheek = landmarks[this.RIGHT_CHEEK];
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];

      // Yaw: horizontal ratio of nose between cheeks
      const cheekWidth = rightCheek.x - leftCheek.x;
      let yawRatio = 0.5;
      if (cheekWidth > 0) {
        yawRatio = (nose.x - leftCheek.x) / cheekWidth;
      }

      // Pitch: vertical ratio of nose between eye line and chin
      const eyeMidY = (leftEye.y + rightEye.y) / 2.0;
      const faceHeight = chin.y - eyeMidY;
      let pitchRatio = 0.5;
      if (faceHeight > 0) {
        pitchRatio = (nose.y - eyeMidY) / faceHeight;
      }

      // Gaze Distraction Thresholds:
      // Turn left: yawRatio > 0.78, Turn right: yawRatio < 0.22
      // Look down at phone: pitchRatio > 0.82, Look straight up: pitchRatio < 0.16
      const isLookingAway = yawRatio < 0.22 || yawRatio > 0.78 || pitchRatio > 0.82 || pitchRatio < 0.16;

      return {
        yawRatio: Number(yawRatio.toFixed(2)),
        pitchRatio: Number(pitchRatio.toFixed(2)),
        isLookingAway: isLookingAway,
      };
    } catch (e) {
      return { yawRatio: 0.5, pitchRatio: 0.5, isLookingAway: false };
    }
  }

  handleResults(results) {
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    const ctx = this.canvasCtx;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(results.image, 0, 0, width, height);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      // Driver Face Missing
      this.distractFrameCount++;
      if (this.distractFrameCount >= this.distractConsecFrames && !this.isDistractAlertActive) {
        this.isDistractAlertActive = true;
        this.totalDistractions++;
        if (this.onAlertTrigger) {
          this.onAlertTrigger({
            type: "DISTRACTION",
            title: "WARNING: Driver Face Not In Frame!",
            message: "Driver is looking away or face is out of camera view.",
            severity: "warning",
            metrics: { ear: 0, mar: 0, yawns: this.totalYawns, microsleeps: this.totalMicrosleeps, distractions: this.totalDistractions },
            image: this.captureSnapshot(),
          });
        }
      }

      if (this.onTelemetryUpdate) {
        this.onTelemetryUpdate({
          faceDetected: false,
          status: "NO_FACE",
          ear: 0,
          mar: 0,
          safetyScore: 35,
          drowsyFrameCount: this.drowsyFrameCount,
          yawnFrameCount: this.yawnFrameCount,
          distractFrameCount: this.distractFrameCount,
          totalYawns: this.totalYawns,
          totalMicrosleeps: this.totalMicrosleeps,
          totalDistractions: this.totalDistractions,
          blinkCount: this.blinkCount,
        });
      }
      ctx.restore();
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // 1. Precise Pixel-Space EAR and MAR computation
    const leftEAR = this.calculateEyeEAR(landmarks, this.LEFT_EYE_PTS, width, height);
    const rightEAR = this.calculateEyeEAR(landmarks, this.RIGHT_EYE_PTS, width, height);
    const avgEAR = Number(((leftEAR + rightEAR) / 2.0).toFixed(3));
    const mar = Number(this.calculateMouthMAR(landmarks, width, height).toFixed(3));
    const headPose = this.calculateHeadPose(landmarks);

    // 2. EYE BLINK & DROWSINESS TRACKER
    let isDrowsy = false;
    if (avgEAR < this.earThreshold) {
      // Eyes are closed
      this.drowsyFrameCount++;
      this.isEyeClosed = true;
    } else {
      // Eyes are open
      if (this.isEyeClosed) {
        // A complete eye blink occurred!
        this.blinkCount++;
        this.isEyeClosed = false;
      }
      this.drowsyFrameCount = 0;
      if (this.isDrowsyAlertActive) {
        this.isDrowsyAlertActive = false;
        if (this.onAlarmStop) this.onAlarmStop("DROWSINESS");
      }
    }

    // Trigger Drowsiness / Sleep Alert if eyes stay closed
    if (this.drowsyFrameCount >= this.earConsecFrames) {
      isDrowsy = true;
      if (!this.isDrowsyAlertActive) {
        this.isDrowsyAlertActive = true;
        this.totalMicrosleeps++;
        if (this.onAlertTrigger) {
          this.onAlertTrigger({
            type: "DROWSINESS",
            title: "CRITICAL: Driver Drowsiness & Sleep!",
            message: `Driver eyes closed for ${((this.drowsyFrameCount / 20) * 1).toFixed(1)}s (EAR: ${avgEAR})`,
            severity: "critical",
            metrics: { ear: avgEAR, mar: mar, yawns: this.totalYawns, microsleeps: this.totalMicrosleeps, distractions: this.totalDistractions },
            image: this.captureSnapshot(),
          });
        }
      }
    }

    // 3. YAWN DETECTION TRACKER
    let isYawning = false;
    if (mar > this.marThreshold) {
      this.yawnFrameCount++;
    } else {
      this.yawnFrameCount = 0;
      if (this.isYawnAlertActive) {
        this.isYawnAlertActive = false;
        if (this.onAlarmStop) this.onAlarmStop("YAWNING");
      }
    }

    // Trigger Yawn Alert if mouth stays wide open
    if (this.yawnFrameCount >= this.marConsecFrames) {
      isYawning = true;
      if (!this.isYawnAlertActive) {
        this.isYawnAlertActive = true;
        this.totalYawns++;
        if (this.onAlertTrigger) {
          this.onAlertTrigger({
            type: "YAWNING",
            title: "WARNING: Driver Fatigue & Yawning!",
            message: `Driver mouth opened wide in a yawn (MAR: ${mar}). Total yawns: ${this.totalYawns}`,
            severity: "warning",
            metrics: { ear: avgEAR, mar: mar, yawns: this.totalYawns, microsleeps: this.totalMicrosleeps, distractions: this.totalDistractions },
            image: this.captureSnapshot(),
          });
        }
      }
    }

    // 4. DISTRACTION TRACKER
    let isDistracted = false;
    if (headPose.isLookingAway) {
      this.distractFrameCount++;
    } else {
      this.distractFrameCount = 0;
      if (this.isDistractAlertActive) {
        this.isDistractAlertActive = false;
        if (this.onAlarmStop) this.onAlarmStop("DISTRACTION");
      }
    }

    if (this.distractFrameCount >= this.distractConsecFrames) {
      isDistracted = true;
      if (!this.isDistractAlertActive) {
        this.isDistractAlertActive = true;
        this.totalDistractions++;
        if (this.onAlertTrigger) {
          this.onAlertTrigger({
            type: "DISTRACTION",
            title: "WARNING: Driver Distraction / Looking Away!",
            message: `Driver looking away or looking down at phone.`,
            severity: "warning",
            metrics: { ear: avgEAR, mar: mar, yawRatio: headPose.yawRatio, pitchRatio: headPose.pitchRatio, yawns: this.totalYawns, microsleeps: this.totalMicrosleeps, distractions: this.totalDistractions },
            image: this.captureSnapshot(),
          });
        }
      }
    }

    // 5. Dynamic Driver Safety Alertness Score (0 - 100)
    let score = 100;
    if (avgEAR < this.earThreshold) {
      score -= Math.min(45, (this.drowsyFrameCount / this.earConsecFrames) * 45);
    }
    if (mar > this.marThreshold) {
      score -= Math.min(30, (this.yawnFrameCount / this.marConsecFrames) * 30);
    }
    if (headPose.isLookingAway) {
      score -= Math.min(25, (this.distractFrameCount / this.distractConsecFrames) * 25);
    }
    score -= Math.min(35, this.totalYawns * 6 + this.totalMicrosleeps * 15 + this.totalDistractions * 6);
    const safetyScore = Math.max(5, Math.min(100, Math.round(score)));

    // 6. Overall Status Badge Label
    let status = "ALERT_NORMAL";
    if (isDrowsy) status = "CRITICAL_DROWSINESS";
    else if (isYawning) status = "YAWNING_WARNING";
    else if (isDistracted) status = "DISTRACTION_WARNING";
    else if (this.drowsyFrameCount > 3) status = "MILD_DROWSY";
    else if (this.totalYawns >= 3) status = "FATIGUE_ADVISORY";

    // 7. Render Visual Landmark Mesh & Dynamic HUD
    this.drawHUD(ctx, width, height, landmarks, isDrowsy, isYawning, isDistracted, avgEAR, mar);

    ctx.restore();

    // 8. Emit Telemetry to Dashboard & Mobile Phone
    if (this.onTelemetryUpdate) {
      this.onTelemetryUpdate({
        faceDetected: true,
        status: status,
        ear: avgEAR,
        mar: mar,
        headPose: headPose,
        safetyScore: safetyScore,
        drowsyFrameCount: this.drowsyFrameCount,
        yawnFrameCount: this.yawnFrameCount,
        distractFrameCount: this.distractFrameCount,
        isDrowsy: isDrowsy,
        isYawning: isYawning,
        isDistracted: isDistracted,
        totalYawns: this.totalYawns,
        totalMicrosleeps: this.totalMicrosleeps,
        totalDistractions: this.totalDistractions,
        blinkCount: this.blinkCount,
      });
    }
  }

  drawHUD(ctx, width, height, landmarks, isDrowsy, isYawning, isDistracted, ear, mar) {
    if (this.showMesh) {
      // Draw Eye Outlines
      const eyeColor = isDrowsy ? "#ef4444" : "#00f2fe";
      this.drawPolygon(ctx, landmarks, [362, 385, 386, 387, 263, 373, 374, 380, 362], width, height, eyeColor);
      this.drawPolygon(ctx, landmarks, [33, 160, 159, 158, 133, 153, 145, 144, 33], width, height, eyeColor);

      // Draw Inner Mouth Contour (Highlights in Amber when Yawning)
      const mouthColor = isYawning ? "#f59e0b" : "#4facfe";
      this.drawPolygon(ctx, landmarks, [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78], width, height, mouthColor);
    }

    // Bounding Box
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    landmarks.forEach((pt) => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });

    const bx = minX * width - 15;
    const by = minY * height - 20;
    const bw = (maxX - minX) * width + 30;
    const bh = (maxY - minY) * height + 35;

    ctx.strokeStyle = isDrowsy ? "#ef4444" : isYawning ? "#f59e0b" : isDistracted ? "#f97316" : "#00f2fe";
    ctx.lineWidth = 2;
    this.drawCornerBox(ctx, bx, by, bw, bh, 20);

    // Gaze Target Crosshair
    const nose = landmarks[this.NOSE_TIP];
    const nx = nose.x * width;
    const ny = nose.y * height;
    ctx.beginPath();
    ctx.arc(nx, ny, 6, 0, 2 * Math.PI);
    ctx.fillStyle = isDistracted ? "#f97316" : "rgba(0, 242, 254, 0.7)";
    ctx.fill();
  }

  drawPolygon(ctx, landmarks, indices, w, h, color) {
    if (indices.length < 2) return;
    ctx.beginPath();
    const first = landmarks[indices[0]];
    ctx.moveTo(first.x * w, first.y * h);
    for (let i = 1; i < indices.length; i++) {
      const pt = landmarks[indices[i]];
      ctx.lineTo(pt.x * w, pt.y * h);
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawCornerBox(ctx, x, y, w, h, len) {
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }

  captureSnapshot() {
    try {
      return this.canvasElement.toDataURL("image/jpeg", 0.75);
    } catch (e) {
      return null;
    }
  }

  resetStats() {
    this.drowsyFrameCount = 0;
    this.yawnFrameCount = 0;
    this.distractFrameCount = 0;
    this.totalYawns = 0;
    this.totalMicrosleeps = 0;
    this.totalDistractions = 0;
    this.blinkCount = 0;
  }
}

// Global instance
window.visionEngine = new VisionEngine();
