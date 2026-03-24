"""
Windows server manager — start/stop/status uvicorn, track PID.
Used by update.bat and install.bat for reliable server lifecycle.
"""
import sys
import os
import subprocess
import time
import socket

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(SCRIPT_DIR, "server.pid")
LOG_FILE = os.path.join(SCRIPT_DIR, "server.log")
UVICORN = os.path.join(SCRIPT_DIR, "venv", "Scripts", "uvicorn.exe")
PORT = 8765


def read_pid():
    try:
        with open(PID_FILE) as f:
            return int(f.read().strip())
    except Exception:
        return None


def is_running(pid):
    if pid is None:
        return False
    try:
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x0400, False, pid)
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return exit_code.value == 259  # STILL_ACTIVE
    except Exception:
        return False


def is_port_open():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=1):
            return True
    except OSError:
        return False


def stop():
    pid = read_pid()
    if pid and is_running(pid):
        print(f"   Stopping PID {pid}...")
        try:
            subprocess.run(["taskkill", "/f", "/t", "/pid", str(pid)],
                           capture_output=True)
        except Exception:
            pass
    # Also kill by port as fallback
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "try { Get-NetTCPConnection -LocalPort 8765 -State Listen -EA Stop"
         " | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } } catch {}"],
        capture_output=True
    )
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    # Give Windows time to release the port
    time.sleep(1)


def start():
    if not os.path.exists(UVICORN):
        print(f"ERROR: uvicorn not found at {UVICORN}")
        sys.exit(1)

    log = open(LOG_FILE, "w")
    proc = subprocess.Popen(
        [UVICORN, "encoder.main:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd=SCRIPT_DIR,
        stdout=log,
        stderr=log,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
    )
    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))
    print(f"   Waiting for server (PID {proc.pid}) to come up...")

    # Wait up to 15s for the server to accept connections
    for i in range(15):
        time.sleep(1)
        if proc.poll() is not None:
            log.close()
            print(f"ERROR: Server process exited early. Last log lines:")
            try:
                with open(LOG_FILE) as lf:
                    lines = lf.readlines()
                    for line in lines[-20:]:
                        print("  ", line.rstrip())
            except Exception:
                pass
            sys.exit(1)
        if is_port_open():
            log.close()
            print(f"   Server is up (PID {proc.pid})")
            return
    log.close()
    print(f"ERROR: Server did not respond on port {PORT} after 15s.")
    print(f"       Check {LOG_FILE} for details.")
    sys.exit(1)


def status():
    pid = read_pid()
    if pid and is_running(pid):
        print(f"   Running (PID {pid})")
        return True
    print("   Not running")
    return False


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "stop":
        stop()
    elif cmd == "start":
        start()
    elif cmd == "restart":
        stop()
        start()
    elif cmd == "status":
        status()
    else:
        print(f"Usage: python server_service.py start|stop|restart|status")
        sys.exit(1)
