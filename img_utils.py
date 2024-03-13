import mozjpeg_lossless_optimization
import io
import pickle
from PIL import Image, ImageCms, ExifTags
import cv2
import gzip
import numpy as np
import math
import logging

def rotate_warp_perspective(pil_img, rect):
    """
    rotate function based on warpPerspective, from
    https://jdhao.github.io/2019/02/23/crop_rotated_rectangle_opencv/

    returns the most blurry results
    """
    opencv_img = np.array(pil_img)
    center, (width, height), angle = rect
    box = cv2.boxPoints(rect)
    box = np.int0(box)
    src_pts = box.astype("float32")
    # coordinate of the points in box points after the rectangle has been
    # straightened
    dst_pts = np.array([[0, int(height)-1],
                        [0, 0],
                        [int(width)-1, 0],
                        [int(width)-1, int(height)-1]], dtype="float32")
    # the perspective transformation matrix
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    # directly warp the rotated rectangle to get the straightened rectangle
    warped = cv2.warpPerspective(opencv_img, M, (int(width), int(height)), cv2.INTER_LANCZOS4)
    return Image.fromarray(warped)

def sanitize_for_postprocessing(pil_img, force_apply_icc=False):
    if pil_img.mode in ["1", "L", "RGB"]:
        if force_apply_icc:
            return apply_icc(pil_img), True
        return pil_img, False
    # opencv rotation can only happen on one or 3 channels, so everything else gets converted
    pil_img = apply_icc(pil_img)
    return pil_img.convert('RGB'), True

def rotate_warp_affine(pil_img, rect):
    """
    rotate function based on warpAffine

    returns acceptable results
    """
    opencv_img = np.array(pil_img)
    res = rotate_warp_affine_cv2(opencv_img, rect)
    return Image.fromarray(res)

def rotate_warp_affine_cv2(opencv_img, rect):
    """
    rotate function based on warpAffine

    returns acceptable results
    """
    binary = opencv_img.dtype == bool
    if binary:
        # for some reason warp affine doesn't work on boolean so we convert the matrix to integers
        opencv_img = opencv_img.astype(np.uint8)
    center, (width, height), angle = rect
    if angle > 45:
        angle = angle-90
        width, height = height, width
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    # or cv2.INTER_LANCZOS4, but CUBIC looks slightly better(?)
    res = cv2.warpAffine(opencv_img, M, (opencv_img.shape[1], opencv_img.shape[0]), flags=cv2.INTER_CUBIC)
    res = cv2.getRectSubPix(res, (int(width), int(height)), center)
    if binary:
        res = res.astype(bool)
    return res

def get_bounding_box(min_area_rect, width, height):
    """
    Returns the smallest bounding box containing the minAreaRect.
    :param min_area_rect: Tuple with center, size, and angle (e.g., ((x,y),(w,h),angle))
    :returns [x, y, w, h]

    Thank you ChatGPT
    """
    # Extract the corner points of the minAreaRect
    box_points = cv2.boxPoints(min_area_rect)
    
    # Find the minimum and maximum x and y coordinates
    x_min = max(0, int(np.min(box_points[:, 0])))
    y_min = max(0, int(np.min(box_points[:, 1])))
    x_max = min(width, int(np.max(box_points[:, 0])))
    y_max = min(height, int(np.max(box_points[:, 1])))

    # Return top-left and bottom-right corner points
    return [x_min, y_min, x_max-x_min, y_max-y_min]

def extract_img(img_orig, ann_info, dst_fname = "", rotate=False):
    """
    extract a subset of an image corresponding to the ann_info (type AnnotationInfo) argument
    """
    if ann_info is None:
        return img_orig
    if not rotate: # default
        return img_orig.crop((ann_info.bbox[0], ann_info.bbox[1], ann_info.bbox[0]+ann_info.bbox[2], ann_info.bbox[1]+ann_info.bbox[3]))
    # subjectively, warp_affine gives a more crisp result
    # the best results are with Gimp's "noHalo" interpolation, but there seems to be
    # no way to use it in Python
    #return rotate_warp_perspective(img_orig, ann_info.minAreaRect)
    return rotate_warp_affine(img_orig, ann_info.minAreaRect)

def encode_img_uncompressed(img) -> (bytes, str):
    """
    returns the bytes of the uncompressed tiff image
    AND the expected file extension
    """
    with io.BytesIO() as output:
        try:
            img.save(output, icc_profile=img.info.get('icc_profile'), format="TIFF", compression="tiff_deflate")
        except:
            return None, ".tiff"
        return output.getvalue(), ".tiff"

def encode_img(img, target_mode=None, mozjpeg_optimize=True):
    """
    returns the bytes of the encoded image (jpg or g4 tiff if binary)
    """
    target_mode = target_mode if target_mode is not None else get_best_mode(img)
    if img.mode != target_mode:
        img = img.convert(target_mode)
    if target_mode != "1":
        jpg_bytes = None
        with io.BytesIO() as output:
            img.save(output, icc_profile=img.info.get('icc_profile'), format="JPEG", quality=85, optimize=True, progressive=True, subsampling="4:2:2", comment="")
            jpg_bytes = output.getvalue()
        if mozjpeg_optimize:
            jpg_bytes = mozjpeg_lossless_optimization.optimize(jpg_bytes)
        return jpg_bytes, ".jpg"
    out_bytes = None
    with io.BytesIO() as output:
        img.save(output, format="PNG")
        out_bytes = output.getvalue()
    return out_bytes, ".png"

def get_best_mode(img):
    """
    returns the best Pillow mode for an image
    """
    if img.mode == "1":
        return "1"
    return "L"

def is_grayscale(img):
    # https://stackoverflow.com/a/23661373/2560906
    # but having a threshold in the differences
    return False

def apply_icc(img):
    """
    Convert PIL image to sRGB color space (if possible)
    """
    icc = img.info.get('icc_profile', '')
    if icc and img.mode not in ["1", "L"]:
        io_handle = io.BytesIO(icc)     # virtual file
        src_profile = ImageCms.ImageCmsProfile(io_handle)
        dst_profile = ImageCms.createProfile('sRGB')
        if img.mode in ["RGB", "RGBA"]:
            ImageCms.profileToProfile(img, src_profile, dst_profile, inPlace=True)
        else:
            img = ImageCms.profileToProfile(img, src_profile, dst_profile, outputMode='RGB')
    return img

def apply_exif_rotation(img):
    """
    apply rotation recorded in exif data

    https://stackoverflow.com/a/26928142/2560906
    """
    for orientation in ExifTags.TAGS.keys():
        if ExifTags.TAGS[orientation]=='Orientation':
            break
    
    exif = None
    try:
        exif = img._getexif()
    except:
        return img
    if exif is None:
        return img

    if exif[orientation] == 3:
        return img.rotate(180, expand=True)
    elif exif[orientation] == 6:
        return img.rotate(270, expand=True)
    elif exif[orientation] == 8:
        return img.rotate(90, expand=True)
    return img

def extract_encode_img(img_orig, sam_annotation, dst_fname, rotate=False):
    cropped_img = extract_img(img_orig, sam_annotation, dst_fname, rotate)
    return encode_img(cropped_img)

COLORS = [
    (0,255,0),
    (255,0,0),
    (0,0,255),
    (255,255,0),
    (0,255,255),
    (255,0,255),
    (0,127,0),
    (127,0,0),
    (0,0,127),
    (127,127,0),
    (0,127,127),
    (127,0,127)
]

def get_debug_img_bytes(img_orig, image_anns, max_size_px=256, draw_rotated=True, line_thickness=2):
    """
    return an encoded jpg with the image annotations represented as rectangles
    the image is converted to RGB and resized
    """
    # resize factor
    rf = max(max_size_px/float(img_orig.size[0]), max_size_px/float(img_orig.size[1]))
    img_orig = img_orig.resize((int(img_orig.size[0]*rf), int(img_orig.size[1]*rf)), Image.BICUBIC)
    # produce an opencv image
    img_orig = img_orig.convert('RGB')
    new_img = cv2.cvtColor(np.array(img_orig), cv2.COLOR_RGB2BGR)
    img_org = None # gc
    # resize_factor
    for i, image_ann in enumerate(image_anns):
        (oldcx, oldcy), (oldw, oldh), angle = image_ann.minAreaRect
        new_rect = ((oldcx*rf,oldcy*rf), (oldw*rf, oldh*rf), angle)
        box = np.int0(cv2.boxPoints(new_rect))
        color = COLORS[i % len(COLORS)]
        cv2.drawContours(new_img, [box], 0, color, line_thickness)
    new_img = Image.fromarray(new_img)
    return encode_img(new_img, target_mode="RGB", mozjpeg_optimize=False)

def sRGB_inverse_gamma(value):
    """Applies the inverse sRGB gamma correction on a normalized RGB value."""
    if value <= 0.04045:
        return value / 12.92
    else:
        return ((value + 0.055) / 1.055) ** 2.4

def sRGB_gamma(value):
    """Applies the sRGB gamma correction on a normalized RGB value."""
    if value <= 0.0031308:
        return 12.92 * value
    else:
        return 1.055 * (value ** (1.0 / 2.4)) - 0.055

def multiply_linear_srgb(srgb_img, rgb_factors):
    """
    This function converts the image in linear sRGB, applies a linear transformation on
    each color channel and then transforms the result in regular sRGB.
    """
    bit_depth = img.dtype.itemsize * 8  # Determine bit depth per channel
    num_channels = img.shape[2] if len(img.shape) > 2 else 1  # Determine number of channels

    # Generate LUTs for each channel
    luts = []
    for c in range(num_channels):
        lut = np.zeros((1 << bit_depth, 1), dtype=np.float32)  # Initialize LUT based on bit depth
        for i in range(lut.shape[0]):
            normalized_val = i / float(lut.shape[0] - 1)  # Normalize to [0, 1]
            # Apply inverse sRGB gamma, multiply by factor, and apply sRGB gamma
            val = sRGB_inverse_gamma(normalized_val)
            val = val * factors[c]
            val = sRGB_gamma(val)
            lut[i] = np.clip(val * (lut.shape[0] - 1), 0, lut.shape[0] - 1)  # Scale back and clip
        
        luts.append(lut.astype(img.dtype))

    # Apply the LUTs to each channel of the image
    if num_channels > 1:
        result_img = cv2.merge([cv2.LUT(img[:, :, c], luts[c]) for c in range(num_channels)])
    else:
        result_img = cv2.LUT(img, luts[0])

    return result_img

def srgb_to_lnsrgb(rgb_array, bps):
    res = []
    for v in rgb_array:
        if bps:
            v = v / 2^bps
        v = sRGB_inverse_gamma(v)
    res.append(v)
    return np.array(res)

def get_linear_factors(srgb_img, bbox, expected_nsRGB):
    x_start, y_start, bbox_w, bbox_h = bbox
    white_patch = srgb_img[y_start:(y_start+bbox_h), x_start:(x_start+bbox_w)]
    median_srgb = np.median(white_patch.reshape(-1, 3), axis=0)
    median_lnsrgb = srgb_to_lnsrgb(median_srgb, 16 if img.dtype.itemsize == 2 else 8)
    expected_lnsrgb = srgb_to_lnsrgb(expected_nsRGB, 0)
    scale_factors = expected_lnsrgb / median_lnsrgb
    return scale_factors

def apply_scale_factors_pil(pil_img, linear_rgb_factors):
    np_img = np.array(img)
    np_transformed_img = multiply_linear_srgb(np_img, linear_rgb_factors)
    pil_img.paste(Image.fromarray(np_transformed_img))

def rotate_mar(rect, n, image_width, image_height):
    """
    Rotates a cv2.minAreaRect around the center of the image by n degrees, where n can be 90, 180, or 270.
    Adjusts the position and orientation of the rectangle accordingly.
    
    Parameters:
    - rect: The cv2.minAreaRect to rotate, in the form ((center_x, center_y), (width, height), angle).
    - n: The rotation angle, which can be 90, 180, or 270 degrees.
    - image_width: Width of the image.
    - image_height: Height of the image.
    
    Returns:
    - A rotated cv2.minAreaRect in the same format.
    """
    
    if n not in [90, 180, 270]:
        raise ValueError("Rotation must be 90, 180, or 270 degrees")
    
    ((center_x, center_y), (width, height), angle) = rect
    image_center = np.array([image_width / 2.0, image_height / 2.0])
    
    # Calculate the new center after rotation
    rect_center = np.array([center_x, center_y])
    rect_center -= image_center  # Translate to rotate around image center
    cos_angle = np.cos(np.radians(n))
    sin_angle = np.sin(np.radians(n))
    rotated_center = np.dot(np.array([[cos_angle, -sin_angle], [sin_angle, cos_angle]]), rect_center)
    rotated_center += image_center  # Translate back after rotation
    
    # Width and height are swapped if rotated by 90 or 270 degrees
    if n == 90 or n == 270:
        new_width, new_height = height, width
    else:  # For 180 degrees, width and height remain the same
        new_width, new_height = width, height
    
    # Adjust angle for rotation
    new_angle = angle - n
    # Normalize the new angle to the range [-90, 0) as per cv2.minAreaRect convention
    if new_angle <= -90:
        new_angle += 180

    return ((rotated_center[0], rotated_center[1]), (new_width, new_height), new_angle)