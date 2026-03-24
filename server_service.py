"""
Windows server manager — start/stop/status uvicorn, track PID.
Used by update.bat and install.bat for reliable server lifecycle.
"""
import sys
import os
import subprocess
import signal

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(SCRIPT_DIR, "server.pid")
UVICORN = os.path.join(SCRIPT_DIR, "venv", "Scripts", "uvicorn.exe")


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


def start():
    if not os.path.exists(UVICORN):
        print(f"ERROR: uvicorn not found at {UVICORN}")
        sys.exit(1)

    proc = subprocess.Popen(
        [UVICORN, "encoder.main:app", "--host", "0.0.0.0", "--port", "8765"],
        cwd=SCRIPT_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))
    print(f"   Server started (PID {proc.pid})")


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
