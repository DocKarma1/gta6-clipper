#!/usr/bin/env python3
"""Transcribe a short cut clip with faster-whisper and emit word timestamps.

Only the cut clip should be passed in — not a live stream or a multi-hour VOD.
Audio is extracted with ffmpeg first so we don't depend on PyAV's open() kwargs.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import wave


def load_pcm16_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise RuntimeError("expected 16-bit PCM wav")
        frames = handle.readframes(handle.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if handle.getnchannels() > 1:
            audio = audio.reshape(-1, handle.getnchannels()).mean(axis=1)
        return audio


def extract_wav(source: Path, dest: Path) -> str | None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-vn", str(dest)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return result.stderr[-2000:] if result.stderr else "ffmpeg could not extract audio"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe a short clip with faster-whisper")
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write(
            "faster-whisper is not installed. In the project .venv run: "
            "pip install -r worker/requirements-python.txt\n"
        )
        json.dump({"text": "", "words": []}, sys.stdout)
        return 2

    fd, tmp_name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)  # Windows: an open handle blocks ffmpeg writes and unlink()
    wav_path = Path(tmp_name)
    try:
        error = extract_wav(Path(args.audio_path), wav_path)
        if error:
            sys.stderr.write(error + "\n")
            json.dump({"text": "", "words": []}, sys.stdout)
            return 1
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(
            load_pcm16_wav(wav_path),
            word_timestamps=True,
            vad_filter=True,
            beam_size=1,
        )
        words: list[dict] = []
        parts: list[str] = []
        for segment in segments:
            if segment.text:
                parts.append(segment.text.strip())
            if not segment.words:
                continue
            for word in segment.words:
                text = (word.word or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "start": round(float(word.start), 3),
                        "end": round(max(float(word.end), float(word.start)), 3),
                        "text": text,
                    }
                )
        json.dump(
            {
                "text": " ".join(parts).strip(),
                "language": getattr(info, "language", None),
                "words": words,
            },
            sys.stdout,
        )
        return 0
    finally:
        wav_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
