#!/usr/bin/env python3
"""Self-hosted transcription stub for cut clips only.

Phase 4 should call faster-whisper (or whisper.cpp) on CPU with a small/base
model. Do not transcribe entire live streams or multi-hour VODs.

This placeholder exits with an instruction until the dependency is installed
on the worker VPS. It does not download models by itself.
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
    args = parser.parse_args()

    sys.stderr.write(
        "faster-whisper is not wired up yet. Install it on the worker VPS in Phase 4, "
        f"then transcribe {args.audio_path} with model={args.model} device={args.device}. "
        "Do not use a paid caption API as the default path.\n"
    )
    json.dump({"text": "", "words": []}, sys.stdout)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
