import io
import logging

import numpy as np
from PIL import Image

from raw_utils import is_likely_raw

logger = logging.getLogger(__name__)


def _blob_bytes(blob):
    blob.seek(0)
    if hasattr(blob, "getvalue"):
        data = blob.getvalue()
        if blob.tell() == 0 and len(data) > 0:
            return data
    data = blob.read()
    blob.seek(0)
    return data


def get_image_size_from_blob(blob, img_path=None):
    """Return (width, height) without fully decoding pixel data when possible."""
    if img_path and is_likely_raw(img_path):
        blob.seek(0)
        with Image.open(blob) as img:
            return img.size

    data = _blob_bytes(blob)
    try:
        import pyvips
        img = pyvips.Image.new_from_buffer(data, "", access="sequential")
        return img.width, img.height
    except Exception:
        logger.debug("vips header read failed, falling back to PIL", exc_info=True)

    with Image.open(io.BytesIO(data)) as img:
        return img.size


def _vips_image_to_pil(vips_img):
    import pyvips

    if vips_img.bands == 1:
        arr = np.ndarray(
            buffer=vips_img.write_to_memory(),
            dtype=np.uint8,
            shape=(vips_img.height, vips_img.width),
        )
        return Image.fromarray(arr, "L")
    if vips_img.bands == 3:
        arr = np.ndarray(
            buffer=vips_img.write_to_memory(),
            dtype=np.uint8,
            shape=(vips_img.height, vips_img.width, 3),
        )
        return Image.fromarray(arr, "RGB")
    if vips_img.bands == 4:
        arr = np.ndarray(
            buffer=vips_img.write_to_memory(),
            dtype=np.uint8,
            shape=(vips_img.height, vips_img.width, 4),
        )
        return Image.fromarray(arr, "RGBA")
    vips_img = vips_img.colourspace("srgb")
    return _vips_image_to_pil(vips_img)


def _decode_with_pil(blob, max_dimension=None):
    data = _blob_bytes(blob)
    img = Image.open(io.BytesIO(data))
    img.load()
    if max_dimension is not None:
        ratio = min(max_dimension / img.width, max_dimension / img.height)
        if ratio < 1.0:
            new_width = int(img.width * ratio)
            new_height = int(img.height * ratio)
            img = img.resize((new_width, new_height), Image.LANCZOS)
    return img


def decode_blob_to_pil(blob, max_dimension=None, img_path=None):
    """
    Decode image bytes to a PIL image.

    When max_dimension is set, use libvips shrink-on-load (thumbnail_buffer) for
    non-RAW files. Falls back to Pillow on failure.
    """
    if img_path and is_likely_raw(img_path):
        blob.seek(0)
        return Image.open(blob)

    data = _blob_bytes(blob)
    try:
        import pyvips

        if max_dimension is not None:
            vips_img = pyvips.Image.thumbnail_buffer(
                data, max_dimension, size=pyvips.Size.DOWN
            )
        else:
            vips_img = pyvips.Image.new_from_buffer(data, "", access="sequential")
        return _vips_image_to_pil(vips_img)
    except Exception as e:
        # WARNING so callers (e.g. scam_postprocess) can capture this in scam_log.json
        logger.warning("vips decode failed (%s), falling back to PIL", e)

    return _decode_with_pil(io.BytesIO(data), max_dimension=max_dimension)
