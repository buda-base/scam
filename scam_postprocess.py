import csv
import sys
import os
import logging
from PIL import Image
from tqdm import tqdm
from img_utils import encode_img_uncompressed, rotate_warp_affine, get_bounding_box, sanitize_for_postprocessing, apply_scale_factors_pil, get_linear_factors, sRGB_inverse_gamma, rotate_mar
from scaapi import get_scam_json
from scam_preprocess import get_pil_img
from utils import upload_to_s3, gets3blob, get_sha256
from raw_utils import register_raw_opener, is_likely_raw, get_np_from_raw, get_factors_from_raw
from natsort import natsort_keygen, natsorted, ns
import numpy as np
import cv2
import exifread
import rawpy
from datetime import datetime
import json
from functools import cmp_to_key

#logging.basicConfig(level=logging.INFO)

DEFAULT_POSTPROCESS_OPTIONS = {
    "rotation_in_derivation": True, # derive tiffs with the small rotation
    "use_exif_rotation": False,
    "src_storage": "s3", # s3 or local
    "dst_storage": "s3", # s3 or local
    "skip_folder_local_output": False, # 
    "skip_folder_local_input": True, # 
    "local_src_folder": "./",
    "local_dst_folder": "./scam_cropped/",
    "add_prefix": "auto", # controls adding an image sequence prefix to the file name, can be True, False or "auto" to do it only if resequencing happens
    "resequence": "auto", # in the case where a prefix can be added, resequence images assuming that one image is all rectos and the next is all versos. "auto" will do that on all images if it can find a pair of consecutive images with 3 pages
    "dryrun": False,
    "output_bps": 8, # can be 8, 16 or "auto" (16 bits if raw with no correction, 8 bits otherwise). Actually 16 and "auto" can't work with PIL
    "correct_non_raw": False, # if True, also applies rgb and exposure corrections to non-raw files
    "rgb_correction": "auto", # can be "default" (see below), "auto" to check for white patch annotations in the folders, or None for no auto_correction
    "rgb_correction_default": ([2.47195, 1.0, 1.9305, 1.0017], 3.2, None), # for the case where no white patch is found
    "wb_patch_nsrgb_target": [0.95, 0.95, 0.95], # the target sRGB values given in [0:1], corresponding to the white patch of the color card
    "force_apply_icc": False, # when False, icc is kept when possible in the output files, if not it is applied
    # compensate exposure:
    # When True, if the folder has some white patch annotations, use it to also compensate exposure. 
    # If ExposureTime is exposed in the exif data, the code will compare the value in the image with the color card and the value in the image and make a ratio
    # if no exposuretime is found, it's assumed that all the images have the same exposure
    "compensate_exposure": True,
}

# pages are 
# "pages": [
#   {
#      "minAreaRect": [cx, cy, w, h, angle]    
#   }
# ]

def get_sequence_info(scam_json, apply_resequence=True, sort_key=None):
    """
    returns two values, first:

    {
       "path/to/file/1": [sequence_num_of_page_1, "sequence_num_of_page_2"], etc.
    }

    second

    True if resequencing has happened in auto mode, False if not
    """
    img_path_to_nb_output_pages = {}
    max_nb_pages = 0
    res = {}
    for file_info in scam_json["files"]:
        img_path = file_info["img_path"]
        pages = get_output_pages(file_info)
        if pages is None:
            continue
        nb_pages = max(1, len(pages)) # 0 counts for 1
        img_path_to_nb_output_pages[img_path] = nb_pages
        max_nb_pages = max(max_nb_pages, nb_pages)
    if sort_key is None:
        sort_key = natsort_keygen(alg=ns.IC|ns.INT)
    sorted_img_paths = sorted(list(img_path_to_nb_output_pages.keys()), key=sort_key)
    if apply_resequence == "auto":
        if max_nb_pages < 3:
            apply_resequence = False
            logging.info("no image has more than 3 pages, no need to apply resequencing")
        else:
            # check if we can find at least two consecutive images with the same number of pages > 3:
            previous_nb_pages = 0
            for img_path in sorted_img_paths:
                nb_pages = img_path_to_nb_output_pages[img_path]
                if nb_pages > 2 and nb_pages == previous_nb_pages:
                    logging.info("applying resequencing because of same number of images %d > 2 for %s and previous one", nb_pages, img_path)
                    apply_resequence = True
                    break
                previous_nb_pages = nb_pages
            logging.info("not applying resequencing")
    if not apply_resequence:
        cur_seq = 1
        for img_path in sorted_img_paths:
            seqs = []
            res[img_path] = seqs
            for i in range(img_path_to_nb_output_pages[img_path]):
                seqs.append(cur_seq)
                cur_seq += 1
    else:
        cur_seq = 1
        recto_img_path = None
        for img_path in sorted_img_paths:
            nb_pages = img_path_to_nb_output_pages[img_path]
            if not recto_img_path and nb_pages > 1:
                recto_img_path = img_path
                continue
            if not recto_img_path and nb_pages < 2:
                res[img_path] = [cur_seq]
                cur_seq += 1
                continue
            nb_pages_recto = img_path_to_nb_output_pages[recto_img_path]
            if nb_pages_recto < nb_pages:
                # we assume that there are always more rectos than versos. If we encounter the opposite, we just
                # sequence normally and output a warning
                res[recto_img_path] = []
                for i in range(nb_pages_recto):
                    res[recto_img_path].append(cur_seq)
                    cur_seq += 1
                recto_img_path = img_path
                continue
            # assume we're on a verso
            res[recto_img_path] = []
            res[img_path] = []
            for i in range(max(nb_pages, nb_pages_recto)):
                if i < nb_pages_recto:
                    res[recto_img_path].append(cur_seq)
                    cur_seq += 1
                if i < nb_pages:
                    res[img_path].append(cur_seq)
                    cur_seq += 1
            recto_img_path = None
    return res, apply_resequence

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
    returns None if the image has no output page
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
            logging.info("ignore duplicate page annotation")
            continue
        previous_minAreaRect = p["minAreaRect"]
        # ignore annotations with some labels:
        if "tags" in p and "T1" in p["tags"]:
            to_delete_idx.append(i)
            continue
        # compute largest_area
        largest_area = max(largest_area, p["minAreaRect"][2]*p["minAreaRect"][3])
    # remove small noisy annotations from the UI:
    for i, p in enumerate(pages):
        if p["minAreaRect"][2]*p["minAreaRect"][3] < 0.05*largest_area:
            to_delete_idx.append(i)
            logging.info("ignore small page annotation")
    res = []
    for i, p in enumerate(pages):
        if i in to_delete_idx:
            continue
        res.append(p)
    if len(res) == 0:
        return None
    return res

def order_pages(pages):
    if len(pages) < 2:
        return pages
    d = get_direction(pages)
    if d == "x":
        return sorted(pages, key=(lambda x: x["minAreaRect"][0]))
    else:
        return sorted(pages, key=(lambda x: x["minAreaRect"][1]))

def derive_from_file(scam_json, scam_log_json, file_info, postprocess_options, prefixes, correction):
    pages = get_output_pages(file_info)
    if pages is None:
        logging.info("do not derive from hidden image %s" % file_info["img_path"])
        return
    pil_img = None
    output_file_info = {
        "original_file_info": file_info,
    }
    if postprocess_options["src_storage"] == "s3":
        if not postprocess_options["dryrun"]:
            pil_img = get_postprocess_pil_img(scam_json["folder_path"], file_info["img_path"], correction, postprocess_options, output_file_info)
    else:
        local_path = postprocess_options["local_src_folder"]
        if not postprocess_options["skip_folder_local_input"]:
            local_path += scam_json["folder_path"]
        local_path += file_info["img_path"]
        if not postprocess_options["dryrun"]:
            # TODO: this is wrong
            pil_img = Image.open(local_path)
    if file_info["rotation"] != 0:
        logging.info("rotate %s by %d", file_info["img_path"], file_info["rotation"])
        if not postprocess_options["dryrun"]:
            pil_img = pil_img.rotate(file_info["rotation"], expand=True)
    if prefixes is not None and max(1, len(pages)) != len(prefixes):
        logging.error("len(pages) != len(prefixes):  %d != %d for %s", max(1, len(pages)), len(prefixes), file_info["img_path"])
        return
    if len(pages) == 0:
        scam_log_json["output_files"].append(output_file_info)
        derive_from_page(scam_json, output_file_info, file_info, pil_img, None, 1, postprocess_options, None if prefixes is None else prefixes[0])
        return
    for i, page in enumerate(pages):
        ofi_p = output_file_info.copy()
        scam_log_json["output_files"].append(ofi_p)
        derive_from_page(scam_json, ofi_p, file_info, pil_img, page, i+1, postprocess_options, None if prefixes is None else prefixes[i])

def derive_from_page(scam_json, output_file_info, file_info, pil_img, page_info, page_position, postprocess_options, prefix=None):
    # page_info is None means we take the whole image
    # page_position starts at 1
    suffix_letter = chr(96+page_position)
    extract = pil_img
    output_file_info["scam_page_info"] = page_info
    output_file_info["page_in_file"] = page_position
    if page_info is not None:
        original_img_w = pil_img.height if file_info["rotation"] in ["-90", "90", "-270", "270"] else pil_img.width
        original_img_h = pil_img.width if file_info["rotation"] in ["-90", "90", "-270", "270"] else pil_img.height
        mar = get_scaled_mar(file_info, page_info, original_img_w, original_img_h)
        if not postprocess_options["rotation_in_derivation"]:
            bbox = get_bounding_box(mar, pil_img.width, pil_img.height)
            output_file_info["crop_bbox"] = bbox
            logging.info("  extract with no rotation (%d, %d, %d, %d)", bbox[0], bbox[1], bbox[0]+bbox[2], bbox[1]+bbox[3])
            if not postprocess_options["dryrun"]:
                extract = pil_img.crop((bbox[0], bbox[1], bbox[0]+bbox[2], bbox[1]+bbox[3]))
        else:
            logging.info("  extract with rotation ((%f, %f), (%f, %f), %f)", mar[0][0], mar[0][1], mar[1][0], mar[1][1], mar[2])
            output_file_info["crop_rect"] = [mar[0][0], mar[0][1], mar[1][0], mar[1][1], mar[2]]
            if not postprocess_options["dryrun"]:
                extract = rotate_warp_affine(pil_img, mar)
    output_path = None
    if postprocess_options["dst_storage"] == "s3":
        s3key = "scam_cropped/"+scam_json["folder_path"]
        if prefix is None:
            output_path = os.path.splitext(file_info["img_path"])[0]+suffix_letter+".tiff"
            s3key += output_path
        else:
            base = ("%04d_" % prefix) + file_info["img_path"].replace("/", "_")
            output_path = os.path.splitext(base)[0]+suffix_letter+".tiff"
            s3key += output_path
        logging.info("  write to s3 key %s", s3key)
        if not postprocess_options["dryrun"]:
            b, ext = encode_img_uncompressed(extract)
            if b is None:
                output_file_info["error"] = "could not encode image"
                logging.error(" got no resulting image for %s", json.dumps(page_info))
                return
            sha256 = get_sha256(b)
            output_file_info["sha256"] = sha256
            upload_to_s3(b, s3key)
    else:
        local_path = postprocess_options["local_dst_folder"]
        if not postprocess_options["skip_folder_local_output"]:
            local_path += scam_json["folder_path"]
        if prefix is None:
            output_path = os.path.splitext(file_info["img_path"])[0]+suffix_letter+".tiff"
            local_path += output_path
        else:
            base = ("%04d_" % prefix) + file_info["img_path"].replace("/", "_")
            output_path = os.path.splitext(base)[0]+suffix_letter+".tiff"
            local_path += output_path
        logging.info("  write to local file %s", local_path)
        if not postprocess_options["dryrun"]:
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            b, ext = encode_img_uncompressed(extract)
            sha256 = get_sha256(b)
            output_file_info["sha256"] = sha256
            with open(local_path, "wb") as binary_file:
                binary_file.write(b)
    output_file_info["output_img_path"] = output_path

def postprocess_folder(folder_path, postprocess_options):
    """
    post-processes a folder for use with the API

    - download scam.json from S3
    """
    scam_log_json = { 
        "folder_path": folder_path,
        "timestamp": str(datetime.now().isoformat()),
        "postprocess_options": postprocess_options,
        "output_files": []
        }
    logging.info("postprocess %s" % folder_path)
    scam_json = get_scam_json(folder_path)
    img_path_to_corr = {}
    img_paths = [file_info["img_path"] for file_info in scam_json["files"]]
    img_paths = natsorted(img_paths, alg=ns.IC|ns.INT)
    if postprocess_options["rgb_correction"] == "auto":
        corrs = get_white_patch_corrections(scam_json, postprocess_options)
        if len(corrs) > 0:
            scam_log_json["found_rgb_corrections"] = {}
            for img_path, corr in corrs.items():
                wb_factors, exp_shift, _ = corr
                scam_log_json["found_rgb_corrections"][img_path] = { "wb_factors": wb_factors, "exp_shift": exp_shift }
            # we potentially use the first correction for images that are
            # before the first image with a color card
            curr_corr = None
            # just looking for the first color card
            for img_path in img_paths:
                if img_path in corrs:
                    cur_corr = corrs[img_path]
                    break
            # then actually fill the corrections
            for img_path in img_paths:
                if img_path in corrs:
                    cur_corr = corrs[img_path]
                img_path_to_corr[img_path] = cur_corr
    if len(img_path_to_corr) == 0:
        for img_path in img_paths:
            img_path_to_corr[img_path] = postprocess_options["rgb_correction_default"]
    if not scam_json["checked"]:
        logging.warning("warning: processing unchecked json %s" % folder_path)
    add_prefix = postprocess_options["add_prefix"]
    sequence_info = None
    if add_prefix == "auto" and not postprocess_options["resequence"]:
        add_prefix = False
    if add_prefix: # "auto" or True
        sequence_info, resequenced = get_sequence_info(scam_json, postprocess_options["resequence"])
        if postprocess_options["resequence"] == "auto" and not resequenced and add_prefix == "auto":
            add_prefix = False
        else:
            add_prefix = True
    for file_info in tqdm(scam_json["files"]):
        if not add_prefix:
            derive_from_file(scam_json, scam_log_json, file_info, postprocess_options, None, img_path_to_corr[file_info["img_path"]])
        elif file_info["img_path"] in sequence_info:
            derive_from_file(scam_json, scam_log_json, file_info, postprocess_options, sequence_info[file_info["img_path"]], img_path_to_corr[file_info["img_path"]])
    scam_log_s3_key = "scam_logs/"+scam_json["folder_path"]+"scam_log.json"
    logging.info("write scam log on %s", scam_log_s3_key)
    scam_log_json_str = json.dumps(scam_log_json, indent=2)
    upload_to_s3(scam_log_json_str.encode('utf-8'), scam_log_s3_key)

def get_bbox(page_info, file_info, img_w, img_h, add_file_info_rotation=False):
    # TODO: test rotation stuff
    if add_file_info_rotation and file_info["rotation"] in [90, -90, 270, -270]:
        img_w, img_h = img_h, img_w
    mar = get_scaled_mar(file_info, page_info, img_w, img_h)
    if add_file_info_rotation and file_info["rotation"]:
        mar = rotate_mar(mar, file_info["rotation"], img_w, img_h)
    return get_bounding_box(mar, img_w, img_h)

def get_raw_corrections(folder_path, img_path, page_info, file_info, postprocess_options):
    """
    returns the corrections for a raw file
    """
    blob = gets3blob(folder_path+img_path)
    if blob is None:
        logging.error("cannot find %s", (folder_path+img_path))
        return
    blob.seek(0)
    tags = exifread.process_file(blob, details=False)
    blob.seek(0)
    raw = raw = rawpy.imread(blob)
    bbox = get_bbox(page_info, file_info, raw.sizes.width, raw.sizes.height, add_file_info_rotation=True)
    logging.error("getting correction factors from %s" % img_path)
    target_lnsrgb_mean = sRGB_inverse_gamma(postprocess_options["wb_patch_nsrgb_target"][0])
    wb_factors, exp_shift = get_factors_from_raw(raw, bbox, target_lnsrgb_mean)
    return wb_factors, exp_shift, tags

def get_cv2_corrections(folder_path, img_path, page_info, file_info, postprocess_options):
    blob = gets3blob(folder_path+img_path)
    if blob is None:
        logging.error("cannot find %s", (folder_path+img_path))
        return
    blob.seek(0)
    tags = exifread.process_file(blob, details=False)
    blob.seek(0)
    pil_img = Image.open(blob)
    pil_img, icc_applied = sanitize_for_postprocessing(pil_img, force_apply_icc=True)
    bbox = get_bbox(page_info, file_info, raw.sizes.width, raw.sizes.height, add_file_info_rotation=True)
    linear_factors = get_linear_factors(np.array(pil_img), bbox, postprocess_options["wb_patch_nsrgb_target"])
    exp_shift = min(linear_factors)
    wb_factors = np.array(linear_factors) / exp_shift
    return wb_factors, exp_shift, tags

def get_cv2_img(folder_path, img_path):
    """
    returns a set with the cv2 image and exif data
    """
    blob = gets3blob(folder_path+img_path)
    if blob is None:
        logging.error("cannot find %s", (folder_path+img_path))
    blob.seek(0)
    tags = exifread.process_file(blob, details=False)
    blob.seek(0)
    if is_likely_raw(img_path):
        np_array = get_cv2_from_raw(blob, "base")
        return cv2.cvtColor(np_array, cv2.COLOR_RGB2BGR), tags
    else:
        pil_img = Image.open(blob)
        pil_img, icc_applied = sanitize_for_postprocessing(pil_img, force_apply_icc=True)
        if pil_img.mode == "RGB":
            return cv2.cvtColor(np.asarray(im_pil), cv2.COLOR_RGB2BGR)
        return np.asarray(im_pil), tags

def get_adjusted_correction(orig_corrections, dest_exif):
    """
    This function takes:
    - the exposure shift factor calculated for the image with the color card
    - the exif data of the image with the color card
    - the exif data of the image we want the new exposure shift
    """
    wb_factors, orig_exp_shift, original_exif = orig_corrections
    if original_exif and dest_exif and "EXIF ExposureTime" in dest_exif and "EXIF ExposureTime" in original_exif:
        exp_diff_factor = float(original_exif.get("EXIF ExposureTime").values[0]) / float(dest_exif.get("EXIF ExposureTime").values[0])
        # the value is usually too big for some reason, this is a random adjustment
        if exp_diff_factor > 1:
            exp_diff_factor = 1 + (exp_diff_factor - 1)/2
        else:
            exp_diff_factor = 1 - (1 - exp_diff_factor)/2
        # TODO: it may be too simplistic
        new_exp_shift = orig_exp_shift * exp_diff_factor
        logging.info("adjust exposure shift correction from %f to %f (%fs vs. %fs)", orig_exp_shift, new_exp_shift, float(original_exif.get("EXIF ExposureTime").values[0]), float(dest_exif.get("EXIF ExposureTime").values[0]))
        return wb_factors, new_exp_shift, original_exif
    return orig_corrections

def get_postprocess_pil_img(folder_path, img_path, params, postprocess_options, output_file_info):
    blob = gets3blob(folder_path+img_path)
    if blob is None:
        logging.error("cannot find %s", (folder_path+img_path))
    blob.seek(0)
    exif = exifread.process_file(blob, details=False)
    blob.seek(0)
    if params and params != "auto":
        params = get_adjusted_correction(params, exif)
        wb_factors, exp_shift, exif = params
        output_file_info["wb_factors"] = wb_factors
        output_file_info["exp_shift"] = exp_shift
    if is_likely_raw(img_path):
        np_img = get_np_from_raw(blob, params, postprocess_options["use_exif_rotation"])
        return Image.fromarray(np_img)
    else:
        pil_img = Image.open(blob)
        pil_img, icc_applied = sanitize_for_postprocessing(pil_img, force_apply_icc=postprocess_options["force_apply_icc"])
        if params and params != "auto" and postprocess_options["correct_non_raw"]:
            if not icc_applied:
                pil_img = apply_icc(pil_img)
            wb_factors, exp_shift, orig_exif = params
            linear_factors = np.array(wb_factors) * exp_shift
            pil_img = apply_scale_factors_pil(pil_img, linear_factors)
        return pil_img

ROTATION_TO_CV2 = {
    -90: cv2.ROTATE_90_CLOCKWISE,
    270: cv2.ROTATE_90_CLOCKWISE,
    90: cv2.ROTATE_90_COUNTERCLOCKWISE,
    -270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    180: cv2.ROTATE_180,
    -180: cv2.ROTATE_180
}

def get_scaled_mar(file_info, page_info, img_w, img_h):
    """
    returns a scaled version of page_info["minAreaRect"] that is scaled in case
    the file_info is smaller than the actual image (which can happens if preprocessing of raw files was deficient)
    img_w, img_h need to be pre-rotation
    returns the minAreaRect in the cv2 format ((cx, cy), (w, h), a)
    """
    c_x, c_y, w, h, a = page_info["minAreaRect"]
    if img_w == file_info["width"] and img_h == file_info["height"]:
        return ((c_x, c_y), (w, h), a)
    scale_factor_x = img_w / file_info["width"]
    scale_factor_y = img_h / file_info["height"]
    return ((c_x*scale_factor_x, c_y*scale_factor_y), (w*scale_factor_x, h*scale_factor_y), a)

def get_white_patch_corrections(scam_json, postprocess_options):
    """
    returns an object with the keys being file paths and values being a set with:
            - wb correction factors derived from white patch annotations. These are not normalized so that the green channel is 1 and thus include some exposure compensation
            - the exif data of the image with the white patch
    """
    res = {}
    for file_info in scam_json["files"]:
        if "pages" not in file_info or len(file_info["pages"]) < 1:
            continue
        img_path = file_info["img_path"]
        for p in file_info["pages"]:
            if "tags" in p and "T1" in p["tags"]:
                if is_likely_raw(file_info["img_path"]):
                    corrs = get_raw_corrections(scam_json["folder_path"], file_info["img_path"], p, file_info, postprocess_options)
                else:
                    corrs = get_cv2_corrections(scam_json["folder_path"], file_info["img_path"], p, file_info, postprocess_options)
                res[img_path] = corrs
                break
    return res

def postprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            postprocess_options=DEFAULT_POSTPROCESS_OPTIONS.copy()
            if len(row) > 1 and "keep in order" in row[1]:
                postprocess_options["resequence"] = False
            postprocess_folder(folder, postprocess_options)

if __name__ == '__main__':
    postprocess_csv()
    #postprocess_folder("NLM1/W8LS32549/sources/W8LS32549-I8LS32588/", DEFAULT_POSTPROCESS_OPTIONS)
