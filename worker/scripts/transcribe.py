#!/usr/bin/env python3
"""Transcribe a short cut clip with faster-whisper and emit word timestamps.

Only the cut clip should be passed in — not a live stream or a multi-hour VOD.
"""

from __future__ import annotations

import argparse
import json
import sys


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

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio_path,
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


if __name__ == "__main__":
    raise SystemExit(main())
