#!/usr/bin/env python3
"""LTC sidecar — outputs music_time_ms JSON lines for Timecode Bridge."""
from __future__ import annotations

import argparse
import json
import sys
import time
import wave


def simulate(duration_ms: int, rate_hz: int = 100) -> None:
    interval = 1.0 / rate_hz
    start = time.monotonic()
    while True:
        elapsed = int((time.monotonic() - start) * 1000)
        if elapsed > duration_ms:
            print(json.dumps({"music_time_ms": duration_ms, "done": True}), flush=True)
            break
        print(json.dumps({"music_time_ms": elapsed}), flush=True)
        time.sleep(interval)


def wav_linear(wav_path: str, rate_hz: int = 100) -> None:
    with wave.open(wav_path, 'rb') as wf:
        duration_ms = int(wf.getnframes() / wf.getframerate() * 1000)

    start = time.monotonic()
    interval = 1.0 / rate_hz
    while True:
        elapsed = int((time.monotonic() - start) * 1000)
        if elapsed > duration_ms:
            print(json.dumps({"music_time_ms": duration_ms, "done": True}), flush=True)
            break
        print(json.dumps({"music_time_ms": elapsed}), flush=True)
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', help='LTC sidecar WAV path')
    parser.add_argument('--simulate', action='store_true')
    parser.add_argument('--duration-ms', type=int, default=180000)
    parser.add_argument('--rate-hz', type=int, default=100)
    args = parser.parse_args()

    if args.simulate:
        simulate(args.duration_ms, args.rate_hz)
        return

    if args.wav:
        sys.stderr.write('Linear WAV replay mode (install python-libltc for real decode)\n')
        wav_linear(args.wav, args.rate_hz)
        return

    parser.error('Provide --wav or --simulate')


if __name__ == '__main__':
    main()
