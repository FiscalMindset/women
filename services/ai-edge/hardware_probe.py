#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import platform
import shutil
import subprocess


def probe() -> dict[str, object]:
    usb = ""
    if shutil.which("lsusb"):
        usb = subprocess.run(["lsusb"], check=False, capture_output=True, text=True).stdout
    elif platform.system() == "Darwin":
        usb = subprocess.run(["system_profiler", "SPUSBDataType"], check=False, capture_output=True, text=True).stdout
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "pycoral": importlib.util.find_spec("pycoral") is not None,
        "tflite_runtime": importlib.util.find_spec("tflite_runtime") is not None,
        "edge_tpu_usb_hint": any(token.lower() in usb.lower() for token in ("coral", "google", "global unichip", "1a6e")),
    }


if __name__ == "__main__":
    print(json.dumps(probe(), indent=2, sort_keys=True))
