import csv
import sys
from scaapi import VERSION, save_scam_json
from utils import list_img_keys, gets3blob, upload_to_s3, get_gzip_picked_bytes
from datetime import datetime
import logging
from PIL import Image
from cal_sam_pickles import get_sam_output
from img_utils import apply_exif_rotation, encode_img, get_best_mode, apply_icc
from tqdm import tqdm
from raw_utils import register_raw_opener
from natsort import natsorted

DEFAULT_PREPROCESS_OPTIONS = {
    "pps": 8,
    "sam_resize": 1024,
    "thumbnail_resize": 512,
    "pre_rotate": 0,
    "use_exif_rotation": False,
    "grayscale_thumbnail": False
}

def run_sam(pil_img, preprocess_options):
    return get_sam_output(pil_img, max_size=preprocess_options["sam_resize"], points_per_side=preprocess_options["pps"])

def save_sam_pickle(pickle_path, sam_res):
    pickle_bytes = get_gzip_picked_bytes(sam_res)
    upload_to_s3(pickle_bytes, pickle_path)

def get_pickle_path(folder_path, img_path):
    return "sam_pickle_gz/"+folder_path+img_path+"_sam_pickle.gz"

def get_all_img_paths(folder_path):
    img_keys = []
    for img_full_key in natsorted(list_img_keys(folder_path)):
        if "_cropped_uncompressed/" in img_full_key:
            continue
        img_keys.append(img_full_key[len(folder_path):])
    return img_keys

RAW_OPENER_REGISTERED = False
def get_pil_img(folder_path, img_path):
    global RAW_OPENER_REGISTERED
    blob = gets3blob(folder_path+img_path)
    if blob is None:
        logging.error("cannot find %s", (folder_path+img_path))
    if not RAW_OPENER_REGISTERED and img_path[-4:].lower() in [".nef", ".cr2", ".dng", ".arw"]:
        print("register raw opener")
        register_raw_opener()
        RAW_OPENER_REGISTERED = True
    img = Image.open(blob)
    return img

def save_thumbnail(folder_path, img_path, pil_img, preprocess_options):
    ratio = max(preprocess_options["thumbnail_resize"] / pil_img.width, preprocess_options["thumbnail_resize"] / pil_img.height)
    new_width = int(pil_img.width * ratio)
    new_height = int(pil_img.height * ratio)
    pil_img = pil_img.resize((new_width, new_height), Image.LANCZOS)
    ext = ".png" if get_best_mode(pil_img) == "1" else ".jpg"
    path = "thumbnails/"+folder_path+img_path+ext
    if preprocess_options["pre_rotate"] != 0:
        pil_img = pil_img.rotate(preprocess_options["pre_rotate"], expand=True)
    try:
        byts, ext = encode_img(pil_img, mozjpeg_optimize=True)
        upload_to_s3(byts, path)
    except Exception as e:
        logging.error("error saving %s" % (folder_path+img_path))
        logging.error(e)
    return path, new_width, new_height

def sanitize_for_preprocessing(pil_img):
    pil_img = apply_icc(pil_img)
    return pil_img.convert('RGB')

def preprocess_folder(folder_path, preprocess_options=DEFAULT_PREPROCESS_OPTIONS):
    """
    pre-processes a folder for use with the API

    - run SAM and save pickles
    - generates and writes thumbnails
    - writes scam.json in the directory
    """
    logging.info("preprocess %s" % folder_path)
    img_paths = get_all_img_paths(folder_path)
    logging.info("found %d images" % len(img_paths))
    scam_json = {
        "preprocess_run": {
            "date": datetime.now().isoformat(),
            "version": VERSION,
            "preprocess_options": preprocess_options,
        },
        "checked": False,
        "folder_path": folder_path,
        "scam_runs": [],
        "files": []
    }
    files = scam_json["files"]
    for img_path in tqdm(img_paths):
        # pil_img is not rotated
        pil_img = None
        sam_res = None
        try:
            pil_img = get_pil_img(folder_path, img_path)
            if preprocess_options["use_exif_rotation"]:
                pil_img = apply_exif_rotation(img)
            #pil_img = sanitize_for_preprocessing(pil_img)
            sam_res = run_sam(pil_img, preprocess_options)
        except Exception as e:
            logging.error("error on %s/%s" % (folder_path, img_path), e)
            continue
        pickle_path = get_pickle_path(folder_path, img_path)
        save_sam_pickle(pickle_path, sam_res)
        # thumbnail will get rotated
        thumbnail_path, w, h = save_thumbnail(folder_path, img_path, pil_img, preprocess_options)
        files.append({
            "img_path": img_path,
            "pickle_path": pickle_path,
            "width": pil_img.width,
            "height": pil_img.height,
            "rotation": preprocess_options["pre_rotate"], # can be modified by users
            "thumbnail_path": thumbnail_path,
            "thumbnail_info": {
                "width": w,
                "height": h,
                "rotation": preprocess_options["pre_rotate"] # inherent to the image, cannot be modified
            }
        })
    save_scam_json(folder_path, scam_json)


def preprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            preprocess_folder(folder)

if __name__ == '__main__':
    preprocess_csv()
