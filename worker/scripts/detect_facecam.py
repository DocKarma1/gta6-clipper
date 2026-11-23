#!/usr/bin/env python3
"""Detect a webcam overlay rectangle in a stream frame or thumbnail.

Face detection uses OpenCV YuNet (model vendored from the OpenCV Zoo,
face_detection_yunet_2023mar.onnx). A Haar cascade is used only if YuNet
cannot be loaded. Rectangle/edge search supports a hard-bordered picture-
in-picture; a face on the left/right edge is enough for a soft-edged cam.
The GTA 6 minimap is rejected unless a face sits inside it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
YUNET = ROOT / "models" / "face_detection_yunet_2023mar.onnx"
HAAR = ROOT / "models" / "haarcascade_frontalface_default.xml"
MIN_CONFIDENCE = 0.55


def clamp_rect(x: int, y: int, w: int, h: int, width: int, height: int) -> tuple[int, int, int, int]:
    x = max(0, min(int(x), width - 1))
    y = max(0, min(int(y), height - 1))
    w = max(8, min(int(w), width - x))
    h = max(8, min(int(h), height - y))
    return x, y, w, h


def on_side_edge(x: int, y: int, w: int, h: int, width: int, height: int) -> bool:
    margin_x = width * 0.30
    return x <= margin_x or x + w >= width - margin_x


def in_corner(x: int, y: int, w: int, h: int, width: int, height: int) -> bool:
    margin_x = width * 0.30
    margin_y = height * 0.28
    left = x <= margin_x
    right = x + w >= width - margin_x
    top = y <= margin_y
    bottom = y + h >= height - margin_y
    return (left or right) and (top or bottom)


def looks_like_minimap(x: int, y: int, w: int, h: int, width: int, height: int) -> bool:
    # GTA 6 mini-map sits in the bottom-left, typically ~2–6% of the frame.
    if y < height * 0.72:
        return False
    if x > width * 0.22:
        return False
    area = (w * h) / max(width * height, 1)
    if area > 0.08 or area < 0.015:
        return False
    ratio = w / max(h, 1)
    return 1.4 <= ratio <= 2.3


def contains(outer: tuple[int, int, int, int], inner: tuple[int, int, int, int]) -> bool:
    ox, oy, ow, oh = outer
    ix, iy, iw, ih = inner
    cx, cy = ix + iw / 2, iy + ih / 2
    return ox <= cx <= ox + ow and oy <= cy <= oy + oh


def find_faces_yunet(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    if not YUNET.is_file():
        return []
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN_create(str(YUNET), "", (width, height), 0.5, 0.3, 20)
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return []
    out: list[tuple[int, int, int, int]] = []
    min_side = max(36, min(width, height) // 24)
    for face in faces:
        x, y, w, h = (int(face[0]), int(face[1]), int(face[2]), int(face[3]))
        if min(w, h) < min_side:
            continue
        out.append(clamp_rect(x, y, w, h, width, height))
    return out


def find_faces_haar(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    if not HAAR.is_file() or not hasattr(cv2, "CascadeClassifier"):
        return []
    cascade = cv2.CascadeClassifier(str(HAAR))
    min_side = max(36, min(gray.shape[:2]) // 24)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(min_side, min_side))
    return [(int(x), int(y), int(w), int(h)) for x, y, w, h in faces]


def find_faces(image: np.ndarray, gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    faces = find_faces_yunet(image)
    return faces if faces else find_faces_haar(gray)


def find_rectangles(gray: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    height, width = gray.shape[:2]
    area = width * height
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 140)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    found: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        contour_area = cv2.contourArea(contour)
        if contour_area < area * 0.012 or contour_area > area * 0.28:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.03 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        x, y, w, h = (int(v) for v in cv2.boundingRect(approx))
        ratio = w / max(h, 1)
        if ratio < 0.55 or ratio > 2.2:
            continue
        fill = contour_area / max(w * h, 1)
        if fill < 0.72:
            continue
        found.append((x, y, w, h, float(fill)))
    found.sort(key=lambda item: item[2] * item[3], reverse=True)
    return found[:12]


def face_to_box(face: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    x, y, w, h = face
    pad_x = int(w * 0.7)
    pad_top = int(h * 0.5)
    pad_bottom = int(h * 1.1)
    return clamp_rect(x - pad_x, y - pad_top, w + 2 * pad_x, h + pad_top + pad_bottom, width, height)


def snap_box_to_border(
    image: np.ndarray,
    face: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[tuple[int, int, int, int], float]:
    """Try a few paddings around the face and keep the box with the strongest border."""
    x, y, w, h = face
    best_box = face_to_box(face, width, height)
    best_strength = border_strength(image, best_box)
    for pad_x_s in (0.35, 0.55, 0.8, 1.1, 1.5):
        for pad_top_s in (0.3, 0.5, 0.8):
            for pad_bot_s in (0.5, 0.9, 1.3, 1.8):
                box = clamp_rect(
                    x - int(w * pad_x_s),
                    y - int(h * pad_top_s),
                    w + 2 * int(w * pad_x_s),
                    h + int(h * pad_top_s) + int(h * pad_bot_s),
                    width,
                    height,
                )
                if not contains(box, face):
                    continue
                strength = border_strength(image, box)
                if strength > best_strength:
                    best_box, best_strength = box, strength
    return best_box, best_strength


def border_strength(image: np.ndarray, rect: tuple[int, int, int, int]) -> float:
    x, y, w, h = rect
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    t = 4
    height, width = gray.shape[:2]
    parts = [
        mag[y : y + h, x : min(width, x + t)],
        mag[y : y + h, max(0, x + w - t) : x + w],
        mag[y : min(height, y + t), x : x + w],
        mag[max(0, y + h - t) : y + h, x : x + w],
    ]
    means = [float(part.mean()) for part in parts if part.size]
    return float(np.mean(means)) if means else 0.0


def detect(image_path: Path) -> dict:
    image = cv2.imread(str(image_path))
    if image is None:
        return {"ok": False, "error": "Could not read image", "confidence": 0, "rect": None}
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = find_faces(image, gray)
    rectangles = find_rectangles(gray)

    candidates: list[dict] = []
    for face in faces:
        box, strength = snap_box_to_border(image, face, width, height)
        matching = next(
            (
                (rx, ry, rw, rh)
                for rx, ry, rw, rh, _ in rectangles
                if contains((rx, ry, rw, rh), face) and not looks_like_minimap(rx, ry, rw, rh, width, height)
            ),
            None,
        )
        if matching:
            box = matching
            strength = border_strength(image, box)
        if looks_like_minimap(*box, width, height):
            continue
        if not on_side_edge(*box, width, height):
            continue
        area = (box[2] * box[3]) / max(width * height, 1)
        if area < 0.008 or area > 0.28:
            continue
        strength = border_strength(image, box)
        score = 0.58
        if in_corner(*box, width, height):
            score += 0.10
        if matching:
            score += 0.14
        if strength >= 40:
            score += 0.10
        elif strength < 16:
            score -= 0.04
        candidates.append(
            {
                "x": box[0],
                "y": box[1],
                "width": box[2],
                "height": box[3],
                "confidence": max(0.0, min(score, 0.98)),
                "method": "rectangle+face" if matching else "face",
                "strength": strength,
                "edge_x": min(box[0], width - (box[0] + box[2])) / max(width, 1),
            }
        )

    # Rectangles alone are never enough on GTA 6: the mini-map is a strong false positive.
    if not candidates:
        return {
            "ok": True,
            "confidence": 0,
            "rect": None,
            "width": width,
            "height": height,
            "faces": len(faces),
            "rectangles": len(rectangles),
        }

    best = max(candidates, key=lambda item: (item["strength"], -item["edge_x"], item["confidence"]))
    return {
        "ok": True,
        "confidence": round(float(best["confidence"]), 3),
        "rect": {
            "x": int(best["x"]),
            "y": int(best["y"]),
            "width": int(best["width"]),
            "height": int(best["height"]),
        },
        "method": best["method"],
        "width": width,
        "height": height,
        "faces": len(faces),
        "rectangles": len(rectangles),
    }


def annotate(image_path: Path, result: dict, output_path: Path) -> None:
    image = cv2.imread(str(image_path))
    if image is None:
        return
    rect = result.get("rect")
    if rect:
        color = (40, 200, 80) if result.get("confidence", 0) >= MIN_CONFIDENCE else (40, 180, 220)
        x, y, w, h = rect["x"], rect["y"], rect["width"], rect["height"]
        cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)
        label = f"{result.get('method', '?')} {result.get('confidence', 0):.2f}"
        cv2.putText(
            image,
            label,
            (x, max(18, y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )
    else:
        cv2.putText(
            image,
            "no facecam",
            (12, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (40, 40, 220),
            2,
            cv2.LINE_AA,
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), image)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--annotate", default="")
    args = parser.parse_args()
    image_path = Path(args.image)
    result = detect(image_path)
    if args.annotate:
        annotate(image_path, result, Path(args.annotate))
    json.dump(result, sys.stdout)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
