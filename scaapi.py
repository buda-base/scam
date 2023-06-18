from datetime import datetime
import pickle
import gzip
from ./cal_sget_sam_output

VERSION = 0.0.1

DEFAULT_PREPROCESS_OPTIONS = {
    "pps": 8,
    "sam_resize": 1024,
    "thumbnail_resize": 512,
    "pre_rotate": 0,
    "use_exif_rotation": False,
    "grayscale_thumbnail": False
}

def get_pickle_path(img_path):
    return "sam_pickle_gz/"+img_path+"_sam_pickle.gz"

def save_thumbnail(folder_path, img_path, pil_img, preprocess_options):
    ratio = max(preprocess_options["thumbnail_resize"] / pil_img.width, preprocess_options["thumbnail_resize"] / pil_img.height)
    new_width = int(pil_img.width * ratio)
    new_height = int(pil_img.height * ratio)
    pil_img = pil_img.resize((new_width, new_height), Image.LANCZOS)
    if preprocess_options["pre_rotate"] != 0:
        pil_img = pil_img.rotate(preprocess_options["pre_rotate"], expand=True)
    byts, ext = encode_img(pil_img, mozjpeg_optimize=True)
    path = "thumbnails/"+img_path+ext
    upload_to_s3(byts, path)

def save_sam_pickle(pickle_path, sam_res):
    pickle_bytes = get_gzip_picked_bytes(sam_res)
    upload_to_s3(pickle_bytes, pickle_path)

def get_gz_pickle(pickle_path):
    blob = gets3blob(pickle_path)
    if blob is None:
        return
    blob.seek(0)
    return pickle.loads(gzip.decompress(blob.read()))

def get_pil_img(folder_path, img_path):
    img = Image.open(gets3blob(folder_path+img_path))
    img = apply_exif_rotation(img)
    return img

def run_sam(pil_img, preprocess_options):


def preprocess_folder(folder_path, preprocess_options=DEFAULT_PREPROCESS_OPTIONS):
    """
    pre-processes a folder for use with the API

    - run SAM and save pickles
    - generates and writes thumbnails
    - writes scam.json in the directory
    """
    img_paths = sorted(get_all_img_paths(folder_path))
    scam_json = {
        "preprocess_run": {
            "date": datetime.now().isoformat(),
            "version": VERSION,
            "preprocess_options": preprocess_options,
        }
        "checked": False,
        "folder_path": folder_path,
        "scam_runs": []
        "files": {}
    }
    files = scam_json["files"]
    for img_path in img_paths:
        # pil_img is not rotated
        pil_img = get_pil_img(folder_path, img_path, preprocess_options)
        sam_res = run_sam(pil_img, preprocess_options)
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

def get_thumbnail_bytes(folder_path, thumbnail_path):
    """
    returns the bytes of the thumbnail
    """
    return gets3blob(thumbnail_path)

DEFAULT_RUN_OPTIONS = {
    "alter_checked": False,
}

DEFAULT_SCAM_OPTIONS = {
    "direction": "vertical",
    "squarishness_min": 0.85,
    "squarishness_min_warn": 0.7,
    "nb_pages_expected": 2,
    "wh_ratio_range": [3.0, 7.0],
    "wh_ratio_range_warn": [1.5, 10.0],
    "area_ratio_min": 0.2,
    "area_diff_max": 0.15,
    "area_diff_max_warn": 0.7,
    "use_rotation": True,
    "fixed_width": None,
    "fixed_height": None,
    "expand_to_fixed": False,
    "cut_at_fixed": False
}

def run_scam_folder(folder_path, run_options = DEFAULT_RUN_OPTIONS, scam_options = DEFAULT_SCAM_OPTIONS):
    """
    runs scam on a folder. The folder must have been preprocessed and have a scam.json file
    """
    scam_json = get_scam_json(folder_path)
    if scam_json is None:
        raise "scam.json not found"
    scam_run_idx = len(scam_json["scam_runs"])
    scam_json["scam_runs"].append({
        "date": datetime.now().isoformat(),
        "version": VERSION,
        "run_options": run_options,
        "scam_options": scam_options
    })
    for file_info in scam_json["files"]:
        if file_info["checked"] and not run_options["alter_checked"]:
            continue
        sam_anns = get_gz_pickle(file_info["pickle_path"])
        add_scam_results(file_info, sam_anns, scam_options)
    save_scam_json(folder_path, scam_json)

def run_scam_image(folder_path, file_info):
    sam_anns = get_gz_pickle(file_info["pickle_path"])
    add_scam_results(file_info, sam_anns, scam_options)
    return file_info

def save_scam_json(folder_path, scam_json_obj):
    scam_json_str = json.dumps(scam_json, indent=2)
    json_file_path = folder_path+"scam.json"
    upload_to_s3(scam_json_str.encode('utf-8'), json_file_path)

def get_scam_json(folder_path):
    json_file_path = folder_path+"scam.json"
    blob = gets3blob(pickle_path)
    if blob is None:
        return None
    blob.seek(0)
    return json.loads(blob.read().decode("utf-8"))