"""
Driver Safety & Fatigue Alert Notifier - Tier 4: Multi-Channel Alert & Dispatch Layer
Flowchart Architecture:
  1. Smartphone Companion (WebSockets, Hardware Vibration, Siren & Strobe, Telemetry Sync)
  2. Telegram Bot API (Instant Photo Snapshot & Alert Dispatch)
  3. Twilio REST API (Twilio Programmable WhatsApp / Voice / API Messaging)
  4. SMS Dispatcher (Dedicated SMS via Direct SMS Gateway, Fast2SMS, Twilio SMS, or Cellular Simulator)
"""

import os
import json
import time
import base64
import html
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("Tier4Notifier")

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


class AlertNotifier:
    def __init__(self):
        # Default Tier 4 Configuration
        self.config: Dict[str, Any] = {
            "smartphone": {
                "enabled": True,
                "vibration_enabled": True,
                "siren_enabled": True,
            },
            "telegram": {
                "enabled": False,
                "bot_token": "",
                "chat_id": "",
                "send_photo": True,
            },
            "twilio": {
                "enabled": False,
                "account_sid": "",
                "auth_token": "",
                "from_number": "",
                "to_number": "",
                "channel": "whatsapp",  # "whatsapp", "sms", "voice"
            },
            "sms": {
                "enabled": True,  # Enabled by default with simulation fallback
                "provider": "cellular_simulator",  # "cellular_simulator", "fast2sms", "twilio_sms", "generic_http"
                "api_key": "",
                "from_number": "DriverGuard-SMS",
                "to_number": "+1234567890",
                "custom_url": "",
            },
            "cooldown_seconds": 10,
        }

        self.last_sent_times: Dict[str, float] = {}
        self.active_websockets: List[Any] = []
        self.sms_inbox: List[Dict[str, Any]] = []

        # Load persisted config if available
        self.load_config_file()

    def load_config_file(self):
        """Load configuration from config.json"""
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    for k, v in saved.items():
                        if isinstance(v, dict) and k in self.config and isinstance(self.config[k], dict):
                            self.config[k].update(v)
                        else:
                            self.config[k] = v
                logger.info("Loaded persisted Tier 4 configuration from config.json")
            except Exception as e:
                logger.warning(f"Failed to read config.json: {e}")

    def save_config_file(self):
        """Persist current configuration to config.json"""
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2)
            logger.info("Saved Tier 4 configuration to config.json")
        except Exception as e:
            logger.warning(f"Failed to save config.json: {e}")

    def update_config(self, new_config: Dict[str, Any]):
        """Update notification configuration for all channels"""
        for key in ["smartphone", "telegram", "twilio", "sms"]:
            if key in new_config and isinstance(new_config[key], dict):
                self.config[key].update(new_config[key])
        if "cooldown_seconds" in new_config and new_config["cooldown_seconds"] is not None:
            self.config["cooldown_seconds"] = int(new_config["cooldown_seconds"])

        self.save_config_file()
        logger.info(f"Notification config updated: {self.config}")

    # ==========================================
    # CHANNEL 1: SMARTPHONE COMPANION (WEBSOCKETS)
    # ==========================================
    def register_websocket(self, websocket: Any):
        """Add active phone/dashboard client WebSocket"""
        if websocket not in self.active_websockets:
            self.active_websockets.append(websocket)
            logger.info(f"WebSocket client connected. Total clients: {len(self.active_websockets)}")

    def unregister_websocket(self, websocket: Any):
        """Remove disconnected WebSocket client"""
        if websocket in self.active_websockets:
            self.active_websockets.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_websockets)}")

    async def broadcast_ws(self, message: Dict[str, Any]):
        """Broadcast event/alert to all connected mobile phone companions & dashboards"""
        disconnected = []
        payload = json.dumps(message)
        for ws in self.active_websockets:
            try:
                await ws.send_text(payload)
            except Exception as e:
                logger.warning(f"Failed to send to client ws: {e}")
                disconnected.append(ws)

        for ws in disconnected:
            self.unregister_websocket(ws)

    def should_send_external(self, alert_type: str) -> bool:
        """Check cooldown window to prevent Telegram/Twilio/SMS flooding"""
        now = time.time()
        last = self.last_sent_times.get(alert_type, 0)
        cooldown = self.config.get("cooldown_seconds", 10)
        if now - last >= cooldown:
            self.last_sent_times[alert_type] = now
            return True
        return False

    # ==========================================
    # CHANNEL 2: TELEGRAM BOT API
    # ==========================================
    def send_telegram_alert(self, title: str, message: str, image_bytes: Optional[bytes] = None) -> Dict[str, Any]:
        """
        Send instant alert and snapshot image to Telegram Bot API.
        Uses clean HTML formatting for 100% reliable rendering without Markdown syntax parsing errors.
        """
        tg = self.config.get("telegram", {})
        if not tg.get("enabled"):
            return {"status": "DISABLED", "message": "Telegram channel is disabled in settings"}

        token = (tg.get("bot_token") or "").strip()
        chat_id = (tg.get("chat_id") or "").strip()
        if not token or not chat_id:
            return {"status": "FAILED", "message": "Telegram Bot Token or Chat ID is missing"}

        safe_title = html.escape(title)
        safe_message = html.escape(message)
        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S")

        html_caption = (
            f"🚨 <b>{safe_title}</b>\n\n"
            f"{safe_message}\n\n"
            f"🕒 <i>Time: {timestamp_str}</i>\n"
            f"🛡️ <i>Tier 4 Cloud Dispatch • DriverGuard AI</i>"
        )

        try:
            send_photo = tg.get("send_photo", True)
            if image_bytes and send_photo:
                url = f"https://api.telegram.org/bot{token}/sendPhoto"
                files = {"photo": ("driver_snapshot.jpg", image_bytes, "image/jpeg")}
                data = {"chat_id": chat_id, "caption": html_caption, "parse_mode": "HTML"}
                resp = requests.post(url, data=data, files=files, timeout=10)
                if resp.status_code == 200:
                    logger.info("Telegram photo alert dispatched successfully")
                    return {"status": "SENT", "message": "Snapshot photo & alert delivered to Telegram"}
                else:
                    logger.warning(f"Telegram sendPhoto failed ({resp.status_code}): {resp.text}. Falling back to sendMessage.")

            # Fallback or text-only
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {"chat_id": chat_id, "text": html_caption, "parse_mode": "HTML"}
            resp = requests.post(url, json=payload, timeout=8)
            if resp.status_code == 200:
                logger.info("Telegram text alert dispatched successfully")
                return {"status": "SENT", "message": "Alert delivered to Telegram"}
            else:
                err_text = resp.json().get("description", resp.text) if resp.headers.get("content-type") == "application/json" else resp.text
                logger.error(f"Telegram dispatch failed: {err_text}")
                return {"status": "FAILED", "message": f"Telegram API error: {err_text}"}

        except Exception as e:
            logger.error(f"Telegram dispatch exception: {e}")
            return {"status": "FAILED", "message": f"Connection error: {str(e)}"}

    # ==========================================
    # CHANNEL 3: TWILIO REST API
    # ==========================================
    def send_twilio_alert(self, title: str, message: str) -> Dict[str, Any]:
        """
        Dispatches emergency alert via Twilio REST API (WhatsApp, Twilio SMS, or Twilio Voice).
        """
        tw = self.config.get("twilio", {})
        if not tw.get("enabled"):
            return {"status": "DISABLED", "message": "Twilio REST API is disabled in settings"}

        sid = (tw.get("account_sid") or "").strip()
        auth_token = (tw.get("auth_token") or "").strip()
        from_num = (tw.get("from_number") or "").strip()
        to_num = (tw.get("to_number") or "").strip()
        channel = tw.get("channel", "whatsapp")

        if not sid or not auth_token or not from_num or not to_num:
            return {"status": "FAILED", "message": "Twilio Account SID, Auth Token, From or To number missing"}

        body_text = f"🚨 [DRIVER SAFETY ALERT]\n{title}\n{message}\nTime: {time.strftime('%H:%M:%S')}"

        if channel == "whatsapp":
            if not from_num.startswith("whatsapp:"):
                from_num = f"whatsapp:{from_num}"
            if not to_num.startswith("whatsapp:"):
                to_num = f"whatsapp:{to_num}"

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"

        try:
            resp = requests.post(
                url,
                data={"From": from_num, "To": to_num, "Body": body_text},
                auth=(sid, auth_token),
                timeout=10,
            )
            if resp.status_code in [200, 201]:
                res_data = resp.json()
                msg_sid = res_data.get("sid", "OK")
                logger.info(f"Twilio REST dispatch succeeded. SID: {msg_sid}")
                return {"status": "SENT", "sid": msg_sid, "message": f"Delivered via Twilio {channel.upper()} (SID: {msg_sid})"}
            else:
                try:
                    res_json = resp.json()
                    err_msg = res_json.get("message", resp.text)
                except Exception:
                    err_msg = resp.text
                logger.error(f"Twilio dispatch failed ({resp.status_code}): {err_msg}")
                return {"status": "FAILED", "message": f"Twilio API error ({resp.status_code}): {err_msg}"}
        except Exception as e:
            logger.error(f"Twilio dispatch exception: {e}")
            return {"status": "FAILED", "message": f"Connection error: {str(e)}"}

    # ==========================================
    # CHANNEL 4: DEDICATED SMS DISPATCHER
    # ==========================================
    def send_sms_alert(self, title: str, message: str) -> Dict[str, Any]:
        """
        Dispatches SMS alert via dedicated SMS Gateway:
          - cellular_simulator: Guaranteed local GSM cellular simulation with live SMS Inbox & carrier receipts
          - fast2sms: Direct Fast2SMS API gateway
          - twilio_sms: Programmable Twilio SMS gateway
          - generic_http: Custom HTTP SMS Gateway / Webhook
        """
        sms_cfg = self.config.get("sms", {})
        if not sms_cfg.get("enabled"):
            return {"status": "DISABLED", "message": "SMS channel is disabled in settings"}

        provider = sms_cfg.get("provider", "cellular_simulator")
        to_number = (sms_cfg.get("to_number") or "+1234567890").strip()
        from_number = (sms_cfg.get("from_number") or "DriverGuard-SMS").strip()
        sms_body = f"🚨 DRIVER ALERT: {title}. {message} [{time.strftime('%H:%M:%S')}]"

        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S")
        sms_id = f"sms_{int(time.time() * 1000)}"

        # 1. Cellular Simulation Mode (Instant, robust, perfect for demos & vivas)
        if provider == "cellular_simulator":
            entry = {
                "id": sms_id,
                "timestamp": timestamp_str,
                "to": to_number,
                "from": from_number,
                "message": sms_body,
                "provider": "Cellular GSM-LTE Gateway (Simulated)",
                "status": "DELIVERED",
                "carrier": "Emergency Cellular Mesh",
            }
            self.sms_inbox.insert(0, entry)
            if len(self.sms_inbox) > 50:
                self.sms_inbox.pop()

            logger.info(f"SMS dispatched via Cellular Simulator to {to_number}")
            return {
                "status": "SIMULATED",
                "provider": "cellular_simulator",
                "recipient": to_number,
                "sms_id": sms_id,
                "message": f"SMS delivered to {to_number} (Cellular GSM Simulated)",
            }

        # 2. Fast2SMS Provider
        elif provider == "fast2sms":
            api_key = (sms_cfg.get("api_key") or "").strip()
            if not api_key:
                return {"status": "FAILED", "message": "Fast2SMS API Key is missing"}

            # Fast2SMS requires 10-digit mobile number in India
            clean_number = "".join(filter(str.isdigit, to_number))
            if len(clean_number) > 10:
                clean_number = clean_number[-10:]

            try:
                url = "https://www.fast2sms.com/dev/bulkV2"
                payload = {
                    "route": "q",
                    "message": sms_body,
                    "language": "english",
                    "flash": 0,
                    "numbers": clean_number,
                }
                headers = {
                    "authorization": api_key,
                    "Content-Type": "application/json",
                }
                resp = requests.post(url, json=payload, headers=headers, timeout=10)
                res_data = resp.json()
                if res_data.get("return") is True:
                    entry = {
                        "id": sms_id,
                        "timestamp": timestamp_str,
                        "to": to_number,
                        "from": from_number,
                        "message": sms_body,
                        "provider": "Fast2SMS Gateway",
                        "status": "DELIVERED",
                    }
                    self.sms_inbox.insert(0, entry)
                    return {"status": "SENT", "message": f"SMS sent via Fast2SMS to {clean_number}"}
                else:
                    return {"status": "FAILED", "message": f"Fast2SMS error: {res_data.get('message', 'Failed')}"}
            except Exception as e:
                return {"status": "FAILED", "message": f"Fast2SMS connection error: {str(e)}"}

        # 3. Twilio SMS
        elif provider == "twilio_sms":
            tw = self.config.get("twilio", {})
            sid = (tw.get("account_sid") or "").strip()
            auth_token = (tw.get("auth_token") or "").strip()
            from_num = (sms_cfg.get("from_number") or tw.get("from_number") or "").strip()
            if not sid or not auth_token or not from_num:
                return {"status": "FAILED", "message": "Twilio credentials or From number missing for Twilio SMS"}

            try:
                url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
                resp = requests.post(
                    url,
                    data={"From": from_num, "To": to_number, "Body": sms_body},
                    auth=(sid, auth_token),
                    timeout=10,
                )
                if resp.status_code in [200, 201]:
                    entry = {
                        "id": sms_id,
                        "timestamp": timestamp_str,
                        "to": to_number,
                        "from": from_num,
                        "message": sms_body,
                        "provider": "Twilio SMS",
                        "status": "DELIVERED",
                    }
                    self.sms_inbox.insert(0, entry)
                    return {"status": "SENT", "message": f"SMS delivered via Twilio to {to_number}"}
                else:
                    return {"status": "FAILED", "message": f"Twilio SMS error ({resp.status_code}): {resp.text}"}
            except Exception as e:
                return {"status": "FAILED", "message": f"Twilio SMS connection error: {str(e)}"}

        # 4. Generic HTTP Gateway
        elif provider == "generic_http":
            custom_url = (sms_cfg.get("custom_url") or "").strip()
            if not custom_url:
                return {"status": "FAILED", "message": "Generic SMS Gateway URL is missing"}

            try:
                # Replace placeholders {to}, {message}
                formatted_url = custom_url.replace("{to}", to_number).replace("{message}", requests.utils.quote(sms_body))
                resp = requests.get(formatted_url, timeout=10)
                if resp.status_code in [200, 201, 202]:
                    entry = {
                        "id": sms_id,
                        "timestamp": timestamp_str,
                        "to": to_number,
                        "from": from_number,
                        "message": sms_body,
                        "provider": "Generic HTTP SMS Gateway",
                        "status": "DELIVERED",
                    }
                    self.sms_inbox.insert(0, entry)
                    return {"status": "SENT", "message": f"SMS sent via Generic HTTP Gateway to {to_number}"}
                else:
                    return {"status": "FAILED", "message": f"Gateway error ({resp.status_code}): {resp.text[:100]}"}
            except Exception as e:
                return {"status": "FAILED", "message": f"Generic Gateway connection error: {str(e)}"}

        return {"status": "FAILED", "message": f"Unknown SMS provider: {provider}"}

    # ==========================================
    # CENTRAL REST API CLOUD DISPATCH (TIER 4)
    # ==========================================
    async def trigger_alert(
        self,
        alert_type: str,
        title: str,
        message: str,
        severity: str = "critical",
        metrics: Optional[Dict[str, Any]] = None,
        image_base64: Optional[str] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Dispatches alert across all 4 channels of Tier 4:
          1. Smartphone Companion (WebSockets, Hardware Vibration, Loud Siren, Live Snapshot)
          2. Telegram Bot API (Instant Photo Snapshot & Alert)
          3. Twilio REST API (Twilio WhatsApp / Voice / API Messaging)
          4. SMS Dispatcher (Direct SMS / Cellular Simulator)
        """
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")

        event_payload = {
            "type": "ALERT",
            "alert_type": alert_type,
            "title": title,
            "message": message,
            "severity": severity,
            "metrics": metrics or {},
            "timestamp": timestamp,
            "has_image": bool(image_base64),
            "image": image_base64,
        }

        # 1. CHANNEL 1: SMARTPHONE COMPANION (ALWAYS INSTANT WEBSOCKET DISPATCH)
        await self.broadcast_ws(event_payload)
        client_count = len(self.active_websockets)

        dispatch_results: Dict[str, Any] = {
            "smartphone_companion": {
                "status": "DELIVERED" if client_count > 0 else "LISTENING",
                "connected_clients": client_count,
                "details": f"Dispatched to {client_count} mobile receiver(s)" if client_count > 0 else "Ready - no phone currently paired",
            },
            "telegram": {"status": "SKIPPED", "details": "Not triggered"},
            "twilio": {"status": "SKIPPED", "details": "Not triggered"},
            "sms": {"status": "SKIPPED", "details": "Not triggered"},
        }

        # Check cooldown unless forced (e.g. Test Alert button)
        can_send_external = force or self.should_send_external(alert_type)

        if can_send_external:
            img_bytes = None
            if image_base64:
                try:
                    if "," in image_base64:
                        raw_data = image_base64.split(",")[1]
                    else:
                        raw_data = image_base64
                    img_bytes = base64.b64decode(raw_data)
                except Exception as e:
                    logger.warning(f"Error decoding base64 image: {e}")

            # 2. CHANNEL 2: TELEGRAM BOT API
            tg_res = self.send_telegram_alert(title, message, img_bytes)
            dispatch_results["telegram"] = {
                "status": tg_res.get("status", "FAILED"),
                "details": tg_res.get("message", ""),
            }

            # 3. CHANNEL 3: TWILIO REST API
            tw_res = self.send_twilio_alert(title, message)
            dispatch_results["twilio"] = {
                "status": tw_res.get("status", "FAILED"),
                "details": tw_res.get("message", ""),
            }

            # 4. CHANNEL 4: SMS DISPATCHER
            sms_res = self.send_sms_alert(title, message)
            dispatch_results["sms"] = {
                "status": sms_res.get("status", "FAILED"),
                "details": sms_res.get("message", ""),
                "provider": sms_res.get("provider", self.config.get("sms", {}).get("provider")),
            }
        else:
            cooldown_left = int(self.config.get("cooldown_seconds", 10))
            dispatch_results["telegram"] = {"status": "COOLDOWN", "details": f"Throttled ({cooldown_left}s anti-spam window active)"}
            dispatch_results["twilio"] = {"status": "COOLDOWN", "details": f"Throttled ({cooldown_left}s anti-spam window active)"}
            dispatch_results["sms"] = {"status": "COOLDOWN", "details": f"Throttled ({cooldown_left}s anti-spam window active)"}

        # Broadcast the dispatch summary report back to Cockpit HUD
        await self.broadcast_ws({
            "type": "TIER4_DISPATCH_RESULT",
            "alert_type": alert_type,
            "title": title,
            "timestamp": timestamp,
            "results": dispatch_results,
        })

        return dispatch_results

    # ==========================================
    # CHANNEL-SPECIFIC TESTING SUITE
    # ==========================================
    async def test_companion_channel(self) -> Dict[str, Any]:
        """Test smartphone companion WebSocket vibration & siren"""
        test_payload = {
            "type": "ALERT",
            "alert_type": "TEST_COMPANION",
            "title": "📱 SMARTPHONE COMPANION TEST",
            "message": "Testing mobile phone vibration, emergency siren & strobe overlay.",
            "severity": "critical",
            "metrics": {"ear": 0.15, "mar": 0.55},
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        await self.broadcast_ws(test_payload)
        client_count = len(self.active_websockets)
        return {
            "channel": "Smartphone Companion",
            "status": "DELIVERED" if client_count > 0 else "LISTENING",
            "connected_devices": client_count,
            "message": f"Dispatched to {client_count} paired smartphone(s)" if client_count > 0 else "Signal broadcasted. Open /companion on phone to pair.",
        }

    def test_telegram_channel(self) -> Dict[str, Any]:
        """Test Telegram Bot API dispatch"""
        return self.send_telegram_alert(
            title="TEST TELEGRAM BOT DISPATCH",
            message="This is a test notification from DriverGuard AI Tier 4 Multi-Channel Dispatch Layer.",
            image_bytes=None,
        )

    def test_twilio_channel(self) -> Dict[str, Any]:
        """Test Twilio REST API dispatch"""
        return self.send_twilio_alert(
            title="TEST TWILIO REST DISPATCH",
            message="Test signal from DriverGuard AI Tier 4 Cloud Dispatch.",
        )

    def test_sms_channel(self) -> Dict[str, Any]:
        """Test SMS Dispatch channel"""
        return self.send_sms_alert(
            title="TEST SMS DISPATCH",
            message="DriverGuard AI Tier 4 Emergency SMS test signal.",
        )


# Global Notifier Instance
notifier = AlertNotifier()
