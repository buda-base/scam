import gzip
import pickle
from PIL import Image
import botocore
from pathlib import Path
from io import StringIO
import io
import boto3
import sys
import cv2
import numpy as np
import torch
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator, SamPredictor
import pickle
from utils import s3_img_key_to_s3_pickle_key, MAX_SIZE, POINTS_PER_SIDE, upload_to_s3, gets3blob, S3, BUCKET_NAME, list_img_keys, get_gzip_picked_bytes
from img_utils import apply_exif_rotation

sam_checkpoint = "sam_vit_h_4b8939.pth"
model_type = "vit_h"

MASK_GENERATOR = None
SAM_MODEL = None

def get_sam_model():
    global SAM_MODEL
    if SAM_MODEL is not None:
        return SAM_MODEL
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    print("using %s" % device)
    sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
    sam.to(device=device)
    SAM_MODEL = sam
    return SAM_MODEL

def get_mask_generator(points_per_side=8):
    sam = get_sam_model()
    #print("generator for points per side = %d" % points_per_side)
    return SamAutomaticMaskGenerator(
        model=sam,
        points_per_side=points_per_side,
        points_per_batch=128,
    #    pred_iou_thresh=0.86,
    #    stability_score_thresh=0.92,
    #    crop_n_layers=1,
    #    crop_n_points_downscale_factor=2,
    #    min_mask_region_area=1000,  # Requires open-cv to run post-processing
    )

def get_sam_output(img, max_size=1024, points_per_side=8):
    if img.mode != "RGB":
        img = img.convert('RGB')
    ratio = max(max_size/img.width, max_size/img.height)
    new_width = int(img.width * ratio)
    new_height = int(img.height * ratio)
    img = img.resize((new_width, new_height), Image.LANCZOS)
    img = np.array(img)
    return get_mask_generator(points_per_side).generate(img)

def calc_sam_pickles(img_s3_path):
    picke_s3_path = s3_img_key_to_s3_pickle_key(img_s3_path)
    if s3key_exists(picke_s3_path):
        return
    print("apply SAM on %s -> %s" % (img_s3_path, picke_s3_path))
    img = Image.open(gets3blob(img_s3_path))
    img = apply_exif_rotation(img)
    sam_results = get_sam_output(img)
    gzipped_pickled_bytes = get_gzip_picked_bytes(sam_results)
    upload_to_s3(gzipped_pickled_bytes, picke_s3_path)
    
def calc_all_sam_pickles(s3_prefix):
    for img_s3_path in list_img_keys(s3_prefix):
        calc_sam_pickles(img_s3_path)

if __name__ == "__main__":
    calc_all_sam_pickles("ER/W1ER120/sources/W1ER120-I1ER790/")