import csv
import sys
import os
import logging
from PIL import Image
from tqdm import tqdm
from img_utils import encode_img_uncompressed, rotate_warp_affine
from scaapi import get_scam_json
from scam_preprocess import get_pil_img
from utils import upload_to_s3
from raw_opener import register_raw_opener
import natsort


DEFAULT_POSTPROCESS_OPTIONS = {
    "rotation_in_derivation": True, # derive tiffs with the small rotation
    "src_storage": "s3", # s3 or local
    "dst_storage": "s3", # s3 or local
    "skip_folder_local_output": False, # 
    "skip_folder_local_input": True, # 
    "local_src_folder": "./",
    "local_dst_folder": "./scam_cropped/",
}

# pages are 
# "pages": [
#   {
#      "minAreaRect": [cx, cy, w, h, angle]    
#   }
# ]


def get_direction(pages):
    """
    returns "x" or "y" depending on the axis of the annotations
    """
    # we need to order the annotations in the page order, sometimes left to right, sometimes top to bottom
    # we get the annotation centers:
    centers_x = []
    centers_y = []
    for page in pages:
        centers_x.append(page["minAreaRect"][0])
        centers_y.append(page["minAreaRect"][1])
    centers_x.sort()
    centers_y.sort()
    var_x = centers_x[-1] - centers_x[0]
    var_y = centers_y[-1] - centers_y[0]
    #print("var_x = %d, var_y = %d" % (var_x, var_y))
    return "x" if var_x > var_y else "y"

def get_output_pages(file_info):
    """
    returns the pages that actually need to be extracted, after a bit of cleanup
    returns [] if the entire page needs to be output
    returns None if the page has just one white patch annotation
    """
    largest_area = 0
    previous_minAreaRect = []
    should_output = False
    if "hidden" in file_info:
        return None
    if "pages" not in file_info or len(file_info["pages"]) < 1:
        return []
    pages = order_pages(file_info["pages"])
    to_delete_idx = []
    for i, p in enumerate(pages):
        # first remove duplicates (which should be in sequence now)
        if p["minAreaRect"] == previous_minAreaRect:
            to_delete_idx.append(i)
            continue
        previous_minAreaRect = p["minAreaRect"]
        # compute largest_area
        largest_area = max(largest_area, p["minAreaRect"][2]*p["minAreaRect"][3])
        # ignore annotations with some labels:
        if "tags" in p and "T1" in p["tags"]:
            to_delete_idx.apend(i)
        else:
            should_output = True
    # remove small noisy annotations from the UI:
    for i, p in enumerate(pages):
        if p["minAreaRect"][2]*p["minAreaRect"][3] < 0.05*largest_area:
            to_delete_idx.append(i)
    res = pages.copy()
    for i, p in enumerate(pages):
        if i in to_delete_idx:
            continue
        res.append(p)
    return res

def order_pages(pages):
    if len(pages) < 2:
        return pages
    d = get_direction(pages)
    if d == "x":
        return sorted(pages, key=(lambda x: x["minAreaRect"][0]))
    else:
        return sorted(pages, key=(lambda x: x["minAreaRect"][1]))

def derive_from_file(scam_json, file_info, postprocess_options):
    pages = get_output_pages(file_info["pages"])
    if pages is None:
        logging.info("do not derive from hidden image %s" % file_info["img_path"])
        return
    pil_img = None
    if postprocess_options["src_storage"] == "s3":
        pil_img = get_pil_img(scam_json["folder_path"], file_info["img_path"])
    else:
        local_path = postprocess_options["local_src_folder"]
        if not postprocess_options["skip_folder_local_input"]:
            local_path += scam_json["folder_path"]
        local_path += file_info["img_path"]
        pil_img = Image.open(local_path)

    # check height and width
    if pil_img.height != file_info["height"] or pil_img.width != file_info["width"]:
        logging.error("got image with different width or height from the original: %s" % file_info["img_path"])
        return
    if file_info["rotation"] != 0:
        pil_img = pil_img.rotate(file_info["rotation"], expand=True)
    if len(pages) == 0:
        derive_from_page(scam_json, file_info, pil_img, None, 1, postprocess_options)
        return
    for i, page in enumerate(pages):
        derive_from_page(scam_json, file_info, pil_img, page, i+1, postprocess_options)

def derive_from_page(scam_json, file_info, pil_img, page_info, page_position, postprocess_options):
    # page_info is None means we take the whole image
    # page_position starts at 1
    suffix_letter = chr(96+page_position)
    extract = pil_img
    if page_info is not None:
        minAreaRect = page_info["minAreaRect"]
        if not postprocess_options["rotation_in_derivation"]:
            bbox = get_bounding_box(page_info["minAreaRect"], pil_img.width, pil_img.height)
            extract = pil_img.crop((bbox[0], bbox[1], bbox[0]+bbox[2], bbox[1]+bbox[3]))
        else:
            mar = page_info["minAreaRect"]
            extract = rotate_warp_affine(pil_img, ((mar[0], mar[1]), (mar[2], mar[3]), mar[4]))
    if postprocess_options["dst_storage"] == "s3":
        s3key = "scam_cropped/"+scam_json["folder_path"]
        s3key += os.path.splitext(file_info["img_path"])[0]+suffix_letter+".tiff"
        b, ext = encode_img_uncompressed(extract)
        upload_to_s3(b, s3key)
    else:
        local_path = postprocess_options["local_dst_folder"]
        if not postprocess_options["skip_folder_local_output"]:
            local_path += scam_json["folder_path"]
        local_path += os.path.splitext(file_info["img_path"])[0]+suffix_letter+".tiff"
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        pil_img.save(local_path, icc_profile=extract.info.get('icc_profile'), format="TIFF", compression="tiff_deflate")

def postprocess_folder(folder_path, postprocess_options=DEFAULT_POSTPROCESS_OPTIONS):
    """
    post-processes a folder for use with the API

    - download scam.json from S3
    """
    logging.info("preprocess %s" % folder_path)
    scam_json = get_scam_json(folder_path)
    if not scam_json["checked"]:
        logging.warning("warning: processing unchecked json %s" % folder_path)
    for file_info in tqdm(scam_json["files"]):
        derive_from_file(scam_json, file_info, postprocess_options)

def postprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            postprocess_folder(folder)

if __name__ == '__main__':
    postprocess_csv()
