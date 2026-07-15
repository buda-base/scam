"""Regression test: bbox-first warp must match full-frame warp pixel-for-pixel."""
import sys

import cv2
import numpy as np

from img_utils import rotate_warp_affine_cv2, rotate_warp_affine_cv2_full_frame


def _max_diff(a, b):
    if a.shape != b.shape:
        return None
    return int(np.max(np.abs(a.astype(np.int16) - b.astype(np.int16))))


def test_rects():
    rng = np.random.default_rng(0)
    img = rng.integers(0, 256, size=(1200, 900, 3), dtype=np.uint8)
    failures = 0
    rects = [
        ((450.0, 600.0), (400.0, 300.0), 12.0),
        ((50.0, 50.0), (120.0, 80.0), -35.0),
        ((850.0, 100.0), (500.0, 200.0), 60.0),
        ((450.0, 600.0), (800.0, 600.0), 5.0),
        ((10.0, 1190.0), (150.0, 100.0), 44.0),
    ]
    for _ in range(20):
        cx = rng.uniform(100, 800)
        cy = rng.uniform(100, 1100)
        w = rng.uniform(80, 700)
        h = rng.uniform(80, 500)
        a = rng.uniform(-45, 45)
        rects.append(((cx, cy), (w, h), a))

    for rect in rects:
        full = rotate_warp_affine_cv2_full_frame(img, rect)
        fast = rotate_warp_affine_cv2(img, rect)
        diff = _max_diff(full, fast)
        if diff is None or diff != 0:
            failures += 1
            print("FAIL", rect, "shape", full.shape, fast.shape, "max_diff", diff)

    if failures:
        print(f"{failures} failures")
        return 1
    print("all warp bbox tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(test_rects())
