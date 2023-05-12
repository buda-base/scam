import mozjpeg_lossless_optimization
import io
import pickle
from PIL import Image, ImageCms
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

def rotate_warp_affine(pil_img, rect):
    """
    rotate function based on warpAffine

    returns acceptable results
    """
    opencv_img = np.array(pil_img)
    center, (width, height), angle = rect
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    # or cv2.INTER_LANCZOS4, but CUBIC looks slightly better(?)
    res = cv2.warpAffine(opencv_img, M, (opencv_img.shape[1], opencv_img.shape[0]), flags=cv2.INTER_CUBIC)
    res = cv2.getRectSubPix(res, (int(width), int(height)), center)
    return Image.fromarray(res)

def extract_img(img_orig, ann_info, dst_fname = "", rotate=False):
    if ann_info is None:
        return img_orig
    if not rotate: # default
        return img_orig.crop((ann_info.bbox[0], ann_info.bbox[1], ann_info.bbox[0]+ann_info.bbox[2], ann_info.bbox[1]+ann_info.bbox[3]))
    # subjectively, warp_affine gives a more crisp result
    # the best results are with Gimp's "noHalo" interpolation, but there seems to be
    # no way to use it in Python
    #return rotate_warp_perspective(img_orig, ann_info.minAreaRect)
    return rotate_warp_affine(img_orig, ann_info.minAreaRect)
    
def encode_img(img, target_mode=None, mozjpeg_optimize=True):
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

def get_best_mode(img):
    return "L"

def is_grayscale(img):
    # https://stackoverflow.com/a/23661373/2560906
    # but having a threshold in the differences
    return False

def apply_icc(img):
    '''Convert PIL image to sRGB color space (if possible)'''
    icc = img.info.get('icc_profile', '')
    if icc and img.mode == "RGB":
        io_handle = io.BytesIO(icc)     # virtual file
        src_profile = ImageCms.ImageCmsProfile(io_handle)
        dst_profile = ImageCms.createProfile('sRGB')
        ImageCms.profileToProfile(img, src_profile, dst_profile, inPlace=True)

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
    img_orig = img_orig.resize((img_orig.size[0]*rf, img_orig.size[1]*rf), Image.BICUBIC)
    # produce an opencv image
    img_orig = img_orig.convert('RGB')
    new_img = cv2.cvtColor(numpy.array(img_orig), cv2.COLOR_RGB2BGR) 
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

