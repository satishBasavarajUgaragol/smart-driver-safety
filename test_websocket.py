import asyncio
import json
import websockets
import requests

async def test_ws():
    uri = "ws://127.0.0.1:8000/ws"
    print(f"Connecting to WebSocket: {uri}...")
    async with websockets.connect(uri) as ws:
        print("Connected successfully! Waiting for INIT_ACK...")
        msg = await ws.recv()
        data = json.loads(msg)
        print("Received from server:", data)
        assert data.get("type") == "INIT_ACK"
        print(" -> WebSocket handshake and INIT_ACK verified! [OK]")

        # Trigger an alert via REST API to verify live broadcast to this WebSocket (phone simulation)
        print("\nTriggering test alert via REST API to verify WebSocket phone broadcast...")
        requests.post("http://127.0.0.1:8000/api/alert", json={
            "alert_type": "DISTRACTION",
            "title": "Live Phone Alert Verification",
            "message": "Testing on-spot phone notification with live image",
            "severity": "warning",
            "metrics": {"ear": 0.28, "mar": 0.15},
            "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        })

        alert_msg = await asyncio.wait_for(ws.recv(), timeout=4.0)
        alert_data = json.loads(alert_msg)
        print("Phone WebSocket received live broadcast:")
        print(" -> Alert Type:", alert_data.get("alert_type"))
        print(" -> Title:", alert_data.get("title"))
        print(" -> Has Image:", alert_data.get("has_image"))
        assert alert_data.get("alert_type") == "DISTRACTION"
        print("\n*** WEBSOCKET REAL-TIME PHONE ALERTS VERIFIED 100% OPERATIONAL! [OK] ***")

if __name__ == "__main__":
    asyncio.run(test_ws())
