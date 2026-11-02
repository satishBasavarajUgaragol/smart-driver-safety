"""
Driver Safety & Fatigue Detection System Launcher
"""

import os
import sys

# Silence TensorFlow and oneDNN console warnings
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import io
import time
import socket
import threading
import webbrowser
import urllib.request
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(backend_dir))

import uvicorn
from app import app, get_local_ip

def free_port_if_in_use(port: int):
    """Release port if occupied by a stale server process"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        s.close()
    except OSError:
        if sys.platform == "win32":
            try:
                import subprocess
                out = subprocess.check_output(f'netstat -ano | findstr :{port}', shell=True).decode()
                for line in out.strip().splitlines():
                    if "LISTENING" in line:
                        pid = line.strip().split()[-1]
                        if pid and pid != str(os.getpid()):
                            os.system(f"taskkill /F /PID {pid} >nul 2>&1")
                time.sleep(1)
            except Exception:
                pass

def open_dashboard(port: int):
    """Wait for server readiness and launch browser directly to the dashboard"""
    url = f"http://localhost:{port}/"
    for _ in range(40):
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.3)
    
    # Launch default web browser and bring window to front
    time.sleep(0.5)
    try:
        if sys.platform == "win32":
            os.system(f'start "" "{url}"')
        else:
            webbrowser.open(url)
    except Exception:
        webbrowser.open(url)

if __name__ == "__main__":
    port = 8000
    free_port_if_in_use(port)
    local_ip = get_local_ip()

    print("=" * 65)
    print(" [*] SMART DRIVER SAFETY & FATIGUE DETECTION SYSTEM ")
    print("=" * 65)
    print(f" • Dashboard URL:  http://localhost:{port}/")
    print(f" • Network URL:    http://{local_ip}:{port}/")
    print(f" • Phone Receiver: http://{local_ip}:{port}/companion")
    print("=" * 65)
    print(" [OK] Server starting on port 8000.")
    print(" [OK] Launching browser directly to dashboard...")
    print("=" * 65)

    threading.Thread(target=open_dashboard, args=(port,), daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
