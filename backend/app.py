"""
Smart Driver Safety & Fatigue Detection Backend Server
Built with FastAPI, WebSockets, OpenCV/MediaPipe Computer Vision & Tier 4 Multi-Channel Phone Alerting.
Flowchart Tiers:
  Tier 1: Perception Layer (Camera -> Raw Frames 720p/1080p @ 30-60 FPS)
  Tier 2: Core Analytics Engine (EAR, MAR, Head Pose, Temporal Threshold, Decision Engine & Alertness Index)
  Tier 3: Cockpit HUD UI (Live Feed, Local Audio Synthesizer & TTS, Alert Signal -> REST API Cloud Dispatch)
  Tier 4: Multi-Channel Alert & Dispatch Layer (Smartphone Companion, Telegram Bot API, Twilio REST API, SMS Dispatcher)
"""

import os
import io
import csv
import json
import time
import socket
import base64
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import detector, HAS_CV
from notifier import notifier

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("DriverSafetyServer")

# Directories
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
SNAPSHOTS_DIR = BASE_DIR / "backend" / "snapshots"
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Smart Driver Safety & Fatigue Detection System - 4 Tier Architecture", version="2.0.0")

# Enable CORS for local/network mobile devices
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory Incident Blackbox Store
incident_log: List[Dict[str, Any]] = []


def get_local_ip() -> str:
    """Retrieve host machine primary local LAN IP for QR phone pairing"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(('10.254.254.254', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_all_network_ips() -> List[str]:
    """Retrieve all active IPv4 addresses (Wi-Fi, Hotspot, Ethernet)"""
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                if ip not in ips:
                    ips.append(ip)
    except Exception:
        pass
    primary = get_local_ip()
    if primary not in ips and not primary.startswith("127.") and not primary.startswith("169.254."):
        ips.insert(0, primary)
    return ips or ["127.0.0.1"]


# --- Data Models ---
class AlertRequest(BaseModel):
    alert_type: str  # "DROWSINESS", "YAWNING", "DISTRACTION", "TEST"
    title: str
    message: str
    severity: str = "critical"  # "critical", "warning", "info"
    metrics: Optional[Dict[str, Any]] = None
    image_base64: Optional[str] = None
    force: bool = False  # If True, bypass cooldown window (for tests/explicit dispatch)


class ConfigUpdateRequest(BaseModel):
    ear_threshold: Optional[float] = None
    ear_consec_frames: Optional[int] = None
    mar_threshold: Optional[float] = None
    mar_consec_frames: Optional[int] = None
    smartphone: Optional[Dict[str, Any]] = None
    telegram: Optional[Dict[str, Any]] = None
    twilio: Optional[Dict[str, Any]] = None
    sms: Optional[Dict[str, Any]] = None
    cooldown_seconds: Optional[int] = None


# --- WebSocket Handler ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    notifier.register_websocket(websocket)

    # Send initial connection greeting with complete state
    await websocket.send_text(json.dumps({
        "type": "INIT_ACK",
        "status": "connected",
        "timestamp": time.time(),
        "detector_state": {
            "ear_threshold": detector.ear_threshold,
            "mar_threshold": detector.mar_threshold,
            "total_yawns": detector.total_yawns,
            "total_microsleeps": detector.total_microsleeps,
        },
        "tier4_channels": {
            "smartphone_companion": len(notifier.active_websockets),
            "telegram": notifier.config.get("telegram", {}).get("enabled", False),
            "twilio": notifier.config.get("twilio", {}).get("enabled", False),
            "sms": notifier.config.get("sms", {}).get("enabled", True),
        }
    }))

    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
                msg_type = msg.get("type", "")

                # 1. Real-time Telemetry stream from camera frontend
                if msg_type == "TELEMETRY":
                    # Broadcast telemetry to companion phones
                    await notifier.broadcast_ws({
                        "type": "TELEMETRY_SYNC",
                        "data": msg.get("data", {})
                    })

                # 2. Alert Trigger from vision engine -> invokes Tier 4 Cloud Dispatch
                elif msg_type == "TRIGGER_ALERT":
                    alert_type = msg.get("alert_type", "FATIGUE")
                    title = msg.get("title", "Safety Warning")
                    message = msg.get("message", "Fatigue detected")
                    severity = msg.get("severity", "warning")
                    metrics = msg.get("metrics", {})
                    img_b64 = msg.get("image_base64")
                    force = msg.get("force", False)

                    # Save incident
                    save_incident(alert_type, title, message, severity, metrics, img_b64)

                    # Tier 4 Multi-Channel Cloud Dispatch
                    await notifier.trigger_alert(
                        alert_type=alert_type,
                        title=title,
                        message=message,
                        severity=severity,
                        metrics=metrics,
                        image_base64=img_b64,
                        force=force,
                    )

                # 3. Ping / Heartbeat
                elif msg_type == "PING":
                    await websocket.send_text(json.dumps({
                        "type": "PONG",
                        "timestamp": time.time(),
                        "phone_clients": len(notifier.active_websockets),
                    }))

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        notifier.unregister_websocket(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        notifier.unregister_websocket(websocket)


def save_incident(
    alert_type: str,
    title: str,
    message: str,
    severity: str,
    metrics: Dict[str, Any],
    img_b64: Optional[str] = None
) -> Dict[str, Any]:
    """Store incident snapshot to disk and add entry to in-memory blackbox"""
    inc_id = f"inc_{int(time.time() * 1000)}"
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    snapshot_filename = None

    if img_b64:
        try:
            if "," in img_b64:
                raw_b64 = img_b64.split(",")[1]
            else:
                raw_b64 = img_b64
            img_bytes = base64.b64decode(raw_b64)
            filename = f"{inc_id}.jpg"
            filepath = SNAPSHOTS_DIR / filename
            with open(filepath, "wb") as f:
                f.write(img_bytes)
            snapshot_filename = f"/api/snapshots/{filename}"
        except Exception as e:
            logger.warning(f"Could not save snapshot file: {e}")

    entry = {
        "id": inc_id,
        "timestamp": timestamp,
        "type": alert_type,
        "title": title,
        "message": message,
        "severity": severity,
        "metrics": metrics,
        "snapshot": snapshot_filename,
    }
    incident_log.insert(0, entry)
    if len(incident_log) > 100:
        incident_log.pop()

    return entry


# ====================================================
# REST API ENDPOINTS (TIER 3 -> TIER 4 CLOUD DISPATCH)
# ====================================================

@app.post("/api/alert")
@app.post("/api/dispatch")
async def create_alert_cloud_dispatch(req: AlertRequest):
    """
    Tier 3 -> Tier 4 Central REST API Cloud Dispatch Endpoint.
    Directly corresponds to the 'REST API Cloud Dispatch' block in the flowchart.
    Dispatches to:
      1. Smartphone Companion
      2. Telegram Bot API
      3. Twilio REST API
      4. SMS Dispatcher
    """
    entry = save_incident(
        alert_type=req.alert_type,
        title=req.title,
        message=req.message,
        severity=req.severity,
        metrics=req.metrics or {},
        img_b64=req.image_base64
    )

    dispatch_results = await notifier.trigger_alert(
        alert_type=req.alert_type,
        title=req.title,
        message=req.message,
        severity=req.severity,
        metrics=req.metrics or {},
        image_base64=req.image_base64,
        force=req.force,
    )

    return {
        "status": "success",
        "incident": entry,
        "tier4_dispatch": dispatch_results,
        "flowchart_pipeline": {
            "tier1_perception": "OK",
            "tier2_analytics": "OK",
            "tier3_cockpit_hud": "OK",
            "tier4_multichannel": dispatch_results,
        }
    }


@app.get("/api/tier4/status")
async def get_tier4_status():
    """
    Returns live connectivity and configuration status for all 4 channels of Tier 4:
      1. Smartphone Companion
      2. Telegram Bot API
      3. Twilio REST API
      4. SMS Dispatcher
    """
    cfg = notifier.config
    tg = cfg.get("telegram", {})
    tw = cfg.get("twilio", {})
    sms = cfg.get("sms", {})

    def mask(s: str) -> str:
        if not s:
            return ""
        if len(s) <= 4:
            return "****"
        return s[:2] + "****" + s[-2:]

    phone_clients = len(notifier.active_websockets)

    return {
        "tier4_layer": "Multi-Channel Alert & Dispatch Layer",
        "channels": {
            "smartphone_companion": {
                "name": "Smartphone Companion",
                "enabled": True,
                "connected_devices": phone_clients,
                "status": "ONLINE" if phone_clients > 0 else "LISTENING",
                "description": "Real-time WebSocket vibration, siren & screen strobe",
            },
            "telegram": {
                "name": "Telegram Bot API",
                "enabled": tg.get("enabled", False),
                "configured": bool(tg.get("bot_token") and tg.get("chat_id")),
                "bot_token_masked": mask(tg.get("bot_token", "")),
                "chat_id_masked": mask(tg.get("chat_id", "")),
                "send_photo": tg.get("send_photo", True),
                "status": "READY" if (tg.get("enabled") and tg.get("bot_token")) else ("DISABLED" if not tg.get("enabled") else "NEEDS_KEYS"),
            },
            "twilio": {
                "name": "Twilio REST API",
                "enabled": tw.get("enabled", False),
                "configured": bool(tw.get("account_sid") and tw.get("auth_token")),
                "account_sid_masked": mask(tw.get("account_sid", "")),
                "channel": tw.get("channel", "whatsapp"),
                "to_number_masked": mask(tw.get("to_number", "")),
                "status": "READY" if (tw.get("enabled") and tw.get("account_sid")) else ("DISABLED" if not tw.get("enabled") else "NEEDS_KEYS"),
            },
            "sms": {
                "name": "SMS Dispatcher",
                "enabled": sms.get("enabled", True),
                "provider": sms.get("provider", "cellular_simulator"),
                "to_number": sms.get("to_number", "+1234567890"),
                "total_sent": len(notifier.sms_inbox),
                "status": "READY",
                "description": "Direct SMS via Cellular Mesh or Gateway",
            },
        },
        "sms_inbox_count": len(notifier.sms_inbox),
        "cooldown_seconds": cfg.get("cooldown_seconds", 10),
    }


# --- Channel Test Endpoints ---

@app.post("/api/test/tier4")
async def test_all_tier4_channels():
    """Trigger full end-to-end test across all 4 channels of Tier 4"""
    results = await notifier.trigger_alert(
        alert_type="TEST_TIER4",
        title="🚨 TIER 4 FULL CLOUD DISPATCH TEST",
        message="Simultaneous dispatch test across Smartphone Companion, Telegram Bot, Twilio REST & SMS.",
        severity="critical",
        metrics={"ear": 0.14, "mar": 0.62, "test": True},
        image_base64=None,
        force=True,
    )
    return {
        "status": "success",
        "message": "Tier 4 Full Dispatch initiated",
        "results": results,
    }


@app.post("/api/test/channel/{channel_name}")
async def test_specific_channel(channel_name: str):
    """Test a specific channel: companion | telegram | twilio | sms"""
    ch = channel_name.lower().strip()
    if ch in ["companion", "smartphone", "smartphone_companion"]:
        res = await notifier.test_companion_channel()
        return {"status": "success", "channel": "Smartphone Companion", "result": res}
    elif ch in ["telegram", "telegram_bot"]:
        res = notifier.test_telegram_channel()
        return {"status": "success" if res.get("status") == "SENT" else "warning", "channel": "Telegram Bot API", "result": res}
    elif ch in ["twilio", "twilio_rest"]:
        res = notifier.test_twilio_channel()
        return {"status": "success" if res.get("status") == "SENT" else "warning", "channel": "Twilio REST API", "result": res}
    elif ch in ["sms", "sms_dispatcher"]:
        res = notifier.test_sms_channel()
        return {"status": "success", "channel": "SMS Dispatcher", "result": res}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {channel_name}. Choose from companion, telegram, twilio, sms.")


@app.get("/api/sms/inbox")
async def get_sms_inbox():
    """Retrieve all dispatched / simulated SMS messages"""
    return {
        "count": len(notifier.sms_inbox),
        "messages": notifier.sms_inbox,
        "provider": notifier.config.get("sms", {}).get("provider", "cellular_simulator"),
    }


@app.post("/api/sms/clear")
async def clear_sms_inbox():
    """Clear SMS inbox history"""
    notifier.sms_inbox.clear()
    return {"status": "success", "message": "SMS inbox cleared"}


@app.get("/api/incidents")
async def list_incidents():
    """Retrieve full incident history"""
    return {
        "count": len(incident_log),
        "incidents": incident_log,
        "summary": {
            "total_yawns": detector.total_yawns,
            "total_microsleeps": detector.total_microsleeps,
            "total_blinks": detector.blink_count,
        }
    }


@app.get("/api/incidents/export")
async def export_incidents(format: str = "json"):
    """Export incident history as CSV or JSON"""
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Incident ID", "Timestamp", "Type", "Title", "Message", "Severity", "EAR", "MAR", "Snapshot URL"])
        for inc in incident_log:
            metrics = inc.get("metrics", {})
            writer.writerow([
                inc["id"],
                inc["timestamp"],
                inc["type"],
                inc["title"],
                inc["message"],
                inc["severity"],
                metrics.get("ear", "N/A"),
                metrics.get("mar", "N/A"),
                inc.get("snapshot", "None"),
            ])
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=driver_fatigue_incidents.csv"}
        )
    return JSONResponse(content={"incidents": incident_log})


@app.get("/api/snapshots/{filename}")
async def get_snapshot(filename: str):
    """Serve incident snapshot image"""
    filepath = SNAPSHOTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(filepath, media_type="image/jpeg")


@app.get("/api/config")
async def get_config():
    """Return current configuration & thresholds across all 4 tiers"""
    return {
        "detector": {
            "ear_threshold": detector.ear_threshold,
            "ear_consec_frames": detector.ear_consec_frames,
            "mar_threshold": detector.mar_threshold,
            "mar_consec_frames": detector.mar_consec_frames,
        },
        "notifier": notifier.config,
        "has_cv": HAS_CV,
    }


@app.post("/api/config")
async def update_config(req: ConfigUpdateRequest):
    """Update settings for detection and Tier 4 phone notifications"""
    detector.update_thresholds({
        "ear_threshold": req.ear_threshold,
        "ear_consec_frames": req.ear_consec_frames,
        "mar_threshold": req.mar_threshold,
        "mar_consec_frames": req.mar_consec_frames,
    })

    notifier_cfg: Dict[str, Any] = {}
    if req.smartphone is not None:
        notifier_cfg["smartphone"] = req.smartphone
    if req.telegram is not None:
        notifier_cfg["telegram"] = req.telegram
    if req.twilio is not None:
        notifier_cfg["twilio"] = req.twilio
    if req.sms is not None:
        notifier_cfg["sms"] = req.sms
    if req.cooldown_seconds is not None:
        notifier_cfg["cooldown_seconds"] = req.cooldown_seconds

    notifier.update_config(notifier_cfg)
    return {"status": "success", "message": "Settings updated and saved to config.json"}


@app.post("/api/reset_trip")
async def reset_trip():
    """Reset current trip statistics"""
    detector.reset_trip()
    incident_log.clear()
    await notifier.broadcast_ws({"type": "TRIP_RESET"})
    return {"status": "success", "message": "Trip data reset"}


@app.get("/api/system_info")
async def system_info(request: Request):
    """Return local host IP and companion pairing URL for mobile phone QR code"""
    local_ip = get_local_ip()
    all_ips = get_all_network_ips()
    port = request.url.port or 8000
    companion_url = f"http://{local_ip}:{port}/companion"
    dashboard_url = f"http://{local_ip}:{port}/"
    return {
        "local_ip": local_ip,
        "all_ips": all_ips,
        "port": port,
        "companion_url": companion_url,
        "dashboard_url": dashboard_url,
        "active_phone_clients": len(notifier.active_websockets),
    }


# --- Static Page Routes ---
@app.get("/")
async def serve_dashboard():
    """Serve Cockpit HUD Dashboard"""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return HTMLResponse("<h1>Driver Safety Dashboard Loading...</h1>")


@app.get("/companion")
async def serve_companion():
    """Serve Mobile Phone Companion Receiver Page"""
    companion_path = FRONTEND_DIR / "companion.html"
    if companion_path.exists():
        return FileResponse(companion_path)
    return HTMLResponse("<h1>Mobile Companion Loading...</h1>")


# Mount static assets (CSS, JS, images, audio)
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
