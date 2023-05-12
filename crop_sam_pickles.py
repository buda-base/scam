from utils import s3_img_key_to_s3_pickle_key, MAX_SIZE, upload_to_s3, gets3blob, S3, BUCKET_NAME, list_img_keys
from img_utils import extract_encode_img, apply_icc, apply_exif_rotation
from sam_annotation_utils import get_image_ann_list
from PIL import Image
import pickle
import gzip
import re
import os

def get_img_pickled(img_s3_path):
    img_orig = Image.open(gets3blob(img_s3_path))
    apply_icc(img_orig)
    pickle_s3_path = s3_img_key_to_s3_pickle_key(img_s3_path)
    blob = gets3blob(pickle_s3_path)
    if blob is None:
        print("error! no "+pickle_s3_path)
        return
    blob.seek(0)
    pickled = gzip.decompress(blob.read())
    blob = None # gc
    anns = pickle.loads(pickled)
    return img_orig, anns

def crop_pickled_image(img_s3_path, cropped_s3_prefix, orig_filename, next_idx):
    img_orig, anns = get_img_pickled(img_s3_path)
    image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height)
    if len(image_ann_infos) != 2:
        print("oops, %d image_ann_infos for %s" % (len(image_ann_infos), img_s3_path))
    dst_base_fname = cropped_s3_prefix[cropped_s3_prefix.rfind("/")+1:]
    if not image_ann_infos:
        image_ann_infos = [ None ]
    for i, image_ann_info in enumerate(image_ann_infos):
        img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, "%s%04d" % (dst_base_fname, next_idx+i), rotate=True)
        suffix_idx = 0 if image_ann_info is None else i+1
        prefix_idx = next_idx+i
        cropped_s3_img_key = "%s%04d0_%s_%02d%s" % (cropped_s3_prefix, prefix_idx, orig_filename, suffix_idx, file_ext)
        print("-> "+cropped_s3_img_key)
        upload_to_s3(img_bytes, cropped_s3_img_key)
    return next_idx + len(image_ann_infos)

def crop_pickled_prefix(s3_prefix):
    next_idx = 1
    cropped_s3_prefix = s3_prefix.replace("/sources/", "/images/")
    for img_s3_path in list_img_keys(s3_prefix):
        img_s3_subpath = img_s3_path[len(s3_prefix):].replace("/","_")
        next_idx = crop_pickled_image(img_s3_path, cropped_s3_prefix, img_s3_subpath, next_idx)

def to_local(s3_key):
    return s3_key[s3_key.rfind("/")+1:]

def debug_pickled(img_s3_path):
    img_fname = "debug/"+to_local(img_s3_path)
    pickle_s3_path = s3_img_key_to_s3_pickle_key(img_s3_path)
    pickle_fname = "debug/"+to_local(pickle_s3_path)
    if not os.path.isfile(img_fname) or not os.path.isfile(pickle_fname):
        S3.download_file(BUCKET_NAME, img_s3_path, img_fname)
        S3.download_file(BUCKET_NAME, pickle_s3_path, pickle_fname)
    img_orig = Image.open(img_fname)
    img_orig = apply_icc(img_orig)
    img_orig = apply_exif_rotation(img_orig)
    with gzip.open(pickle_fname, 'rb') as f:
        anns = pickle.load(f)
        image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height, img_fname)
        for i, image_ann_info in enumerate(image_ann_infos):
            fname_base = "debug/"+to_local(img_s3_path)+("_%02d" % i)
            img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, fname_base, rotate=True)
            with open(fname_base+file_ext, "wb") as binary_file:
                binary_file.write(img_bytes)

if __name__ == "__main__":
    crop_pickled_prefix("ER/W1ER120/sources/W1ER120-I1ER790/")
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56008.JPG") # 2 squares
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56011.JPG") # normal case
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56012.JPG")
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56022.JPG") # merge / split
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56062.JPG") # duplicate mask
    #debug_pickled("ER/W1ER120/sources/W1ER120-I1ER790/IMG_56069.JPG")