from cal_sam_pickles import s3_img_key_to_s3_pickle_key, MAX_SIZE, upload_to_s3, gets3blob, S3, BUCKET_NAME, list_img_keys
from img_utils import extract_encode_img, apply_icc, get_image_ann_list
from PIL import Image
import pickle
import gzip
import re

DEST = "local"

def crop_pickled_image(img_s3_path, cropped_s3_prefix, next_idx):
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
    image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height)
    if len(image_ann_infos) != 2:
        print("oops, %d image_ann_infos for %s" % (len(image_ann_infos), img_s3_path))
    dst_base_fname = cropped_s3_prefix[cropped_s3_prefix.rfind("/")+1:]
    for i, image_ann_info in enumerate(image_ann_infos):
        img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, "%s%04d" % (dst_base_fname, next_idx+i))
        cropped_s3_img_key = "%s%04d%s" % (cropped_s3_prefix, next_idx+i, file_ext)
        print("-> "+cropped_s3_img_key)
        upload_to_s3(img_bytes, cropped_s3_img_key)
    return next_idx + len(image_ann_infos)

def crop_pickled_prefix(s3_prefix):
    next_idx = 1
    cropped_s3_prefix = s3_prefix.replace("/sources/", "/images/")
    cropped_s3_prefix = re.sub(r"-(I[A-Z_0-9]+)/$", r"-\1/\1", cropped_s3_prefix)
    for img_s3_path in list_img_keys(s3_prefix):
        next_idx = crop_pickled_image(img_s3_path, cropped_s3_prefix, next_idx)

if __name__ == "__main__":
    crop_pickled_prefix("ER/W1ER120/sources/W1ER120-I1ER790/")