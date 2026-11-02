import requests
import base64

def test_api():
    base_url = "http://127.0.0.1:8000"
    
    # 1x1 dummy jpg image base64
    dummy_img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="

    print("1. Testing GET /api/config...")
    r1 = requests.get(f"{base_url}/api/config")
    print(" -> Status:", r1.status_code)
    assert r1.status_code == 200

    print("2. Testing GET /api/tier4/status...")
    r_t4 = requests.get(f"{base_url}/api/tier4/status")
    print(" -> Status:", r_t4.status_code, "Channels:", list(r_t4.json()["channels"].keys()))
    assert r_t4.status_code == 200
    assert "smartphone_companion" in r_t4.json()["channels"]
    assert "telegram" in r_t4.json()["channels"]
    assert "twilio" in r_t4.json()["channels"]
    assert "sms" in r_t4.json()["channels"]

    print("3. Testing POST /api/test/channel/sms...")
    r_sms = requests.post(f"{base_url}/api/test/channel/sms")
    print(" -> Status:", r_sms.status_code, "Result:", r_sms.json()["result"]["status"])
    assert r_sms.status_code == 200

    print("4. Testing GET /api/sms/inbox...")
    r_inbox = requests.get(f"{base_url}/api/sms/inbox")
    print(" -> Status:", r_inbox.status_code, "Total SMS in inbox:", r_inbox.json()["count"])
    assert r_inbox.status_code == 200
    assert r_inbox.json()["count"] >= 1

    print("5. Testing POST /api/dispatch (REST API Cloud Dispatch from Tier 3)...")
    r_disp = requests.post(f"{base_url}/api/dispatch", json={
        "alert_type": "DROWSINESS",
        "title": "Driver Drowsiness Detected",
        "message": "Eyes closed for 1.8s (EAR: 0.14)",
        "severity": "critical",
        "metrics": {"ear": 0.14, "mar": 0.20},
        "image_base64": dummy_img,
        "force": True
    })
    print(" -> Status:", r_disp.status_code, "Tier 4 Dispatched:", r_disp.json()["tier4_dispatch"])
    assert r_disp.status_code == 200
    assert "tier4_dispatch" in r_disp.json()

    print("6. Testing POST /api/test/tier4 (Full Multi-Channel Test)...")
    r_all = requests.post(f"{base_url}/api/test/tier4")
    print(" -> Status:", r_all.status_code, "Results:", r_all.json()["results"])
    assert r_all.status_code == 200

    print("7. Testing GET /api/incidents...")
    r_inc = requests.get(f"{base_url}/api/incidents")
    incidents = r_inc.json()["incidents"]
    print(" -> Status:", r_inc.status_code, "Total incidents recorded:", len(incidents))
    assert r_inc.status_code == 200
    assert len(incidents) >= 1

    print("\nALL TIER 4 MULTI-CHANNEL CLOUD DISPATCH TESTS PASSED! [OK]")

if __name__ == "__main__":
    test_api()
