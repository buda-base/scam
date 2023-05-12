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
from utils import s3_img_key_to_s3_pickle_key, MAX_SIZE, upload_to_s3, gets3blob, S3, BUCKET_NAME, list_img_keys

sam_checkpoint = "sam_vit_h_4b8939.pth"
model_type = "vit_h"

MASK_GENERATOR = None

def get_mask_generator():
    global MASK_GENERATOR
    if MASK_GENERATOR is not None:
        return MASK_GENERATOR
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    print("using %s" % device)
    sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
    sam.to(device=device)
    MASK_GENERATOR = SamAutomaticMaskGenerator(
        model=sam,
        points_per_side=8,
        points_per_batch=128,
    #    pred_iou_thresh=0.86,
    #    stability_score_thresh=0.92,
    #    crop_n_layers=1,
    #    crop_n_points_downscale_factor=2,
    #    min_mask_region_area=1000,  # Requires open-cv to run post-processing
    )
    return MASK_GENERATOR


POINTS_PER_SIDE = 8

def calc_sam_pickles(img_s3_path):
    picke_s3_path = s3_img_key_to_s3_pickle_key(img_s3_path)
    if s3key_exists(picke_s3_path):
        return
    print("apply SAM on %s -> %s" % (img_s3_path, picke_s3_path))
    img = Image.open(gets3blob(img_s3_path))
    ratio = max(MAX_SIZE/img.width, MAX_SIZE/img.height)
    new_width = int(img.width * ratio)
    new_height = int(img.height * ratio)
    img = img.resize((new_width, new_height), Image.LANCZOS)
    img = np.array(img)
    sam_results = get_mask_generator().generate(img)
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb") as f:
        pickle.dump(sam_results, f)
    gzipped_pickled_bytes = out.getvalue()
    # gc
    sam_results = None
    img = None
    out = None
    upload_to_s3(gzipped_pickled_bytes, picke_s3_path)
    
def calc_all_sam_pickles(s3_prefix):
    for img_s3_path in list_img_keys(s3_prefix):
        calc_sam_pickles(img_s3_path)

if __name__ == "__main__":
    calc_all_sam_pickles("ER/W1ER120/sources/W1ER120-I1ER790/")