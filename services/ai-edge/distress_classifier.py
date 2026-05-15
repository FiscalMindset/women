#!/usr/bin/env python3
from __future__ import annotations

import argparse
import dataclasses
import json
import platform
import sys
import time
import wave
from pathlib import Path

import numpy as np


DISTRESS_LABELS = {"distress", "scream", "crying", "help", "emergency", "glass", "gunshot"}


@dataclasses.dataclass(frozen=True, slots=True)
class ClassificationResult:
    distress: bool
    label: str
    confidence: float
    accelerator: str
    latency_ms: float


def _load_labels(path: Path) -> list[str]:
    labels: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        labels.append(parts[-1] if parts[0].isdigit() and len(parts) == 2 else stripped)
    return labels


def _read_pcm16_mono(path: Path, target_samples: int) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        frames = wav.readframes(wav.getnframes())
        channels = wav.getnchannels()
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
    if samples.size < target_samples:
        samples = np.pad(samples, (0, target_samples - samples.size))
    return samples[:target_samples]


def _make_interpreter(model_path: Path):
    try:
        from pycoral.utils.edgetpu import make_interpreter

        interpreter = make_interpreter(str(model_path))
        return interpreter, "coral-edge-tpu"
    except Exception as exc:
        try:
            from tflite_runtime.interpreter import Interpreter
        except Exception as runtime_exc:
            raise RuntimeError(
                "Neither PyCoral Edge TPU nor tflite_runtime CPU interpreter is available"
            ) from runtime_exc
        print(f"Edge TPU unavailable, falling back to CPU TFLite: {exc}", file=sys.stderr)
        return Interpreter(model_path=str(model_path)), "tflite-cpu"


def classify(audio_path: Path, model_path: Path, labels_path: Path, min_confidence: float) -> ClassificationResult:
    labels = _load_labels(labels_path)
    interpreter, accelerator = _make_interpreter(model_path)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]

    input_shape = input_details["shape"]
    target_samples = int(np.prod(input_shape[1:])) if len(input_shape) > 1 else int(input_shape[0])
    waveform = _read_pcm16_mono(audio_path, target_samples)

    if input_details["dtype"] == np.uint8:
        scale, zero_point = input_details["quantization"]
        tensor = np.clip(waveform / scale + zero_point, 0, 255).astype(np.uint8)
    elif input_details["dtype"] == np.int8:
        scale, zero_point = input_details["quantization"]
        tensor = np.clip(waveform / scale + zero_point, -128, 127).astype(np.int8)
    else:
        tensor = waveform.astype(input_details["dtype"])

    tensor = tensor.reshape(input_shape)
    started = time.perf_counter()
    interpreter.set_tensor(input_details["index"], tensor)
    interpreter.invoke()
    latency_ms = (time.perf_counter() - started) * 1000.0

    output = interpreter.get_tensor(output_details["index"])[0]
    if np.issubdtype(output.dtype, np.integer):
        scale, zero_point = output_details["quantization"]
        output = (output.astype(np.float32) - zero_point) * scale
    index = int(np.argmax(output))
    confidence = float(output[index])
    label = labels[index] if index < len(labels) else str(index)
    distress = confidence >= min_confidence and label.lower() in DISTRESS_LABELS
    return ClassificationResult(distress, label, confidence, accelerator, latency_ms)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--min-confidence", type=float, default=0.82)
    args = parser.parse_args()

    result = classify(args.audio, args.model, args.labels, args.min_confidence)
    print(json.dumps(dataclasses.asdict(result), separators=(",", ":")))


if __name__ == "__main__":
    main()
