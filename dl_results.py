from utils import S3, BUCKET_NAME, list_obj_keys, is_img
from img_utils import encode_img
from openpecha.buda.api import get_buda_scan_info
import shutil
import sys
from natsort import natsorted, ns
from glob import glob
import csv
import os
from pathlib import Path
import logging
from PIL import Image
import mozjpeg_lossless_optimization
from datetime import datetime
import random
from parallel_executor import ParallelTaskExecutor
import statistics
from tqdm import tqdm
import io
import math

WINFOS_CACHE = {}
DEFAULT_NBINTROPAGES = 0
DOWNLOAD_FROM_S3 = False
OVERWRITE_IMG_FILES = True
DEBUG_CSV = False

def sanitize_fname_for_archive(fpath, imgnum):
    fpath = fpath.replace("/", "_").replace(" ", "_").replace("'", "v").replace('"', "")
    suffix = "%04d" % imgnum
    fpathnoext = fpath[:fpath.rfind(".")]
    if not fpathnoext.endswith(suffix):
        fpath = fpathnoext+"_"+suffix+fpath[fpath.rfind("."):]
    return fpath

def download_archive_folder_into(s3prefix, dst_dir, nb_intro_pages, ilname, prefix, bucket=BUCKET_NAME):
    obj_keys = natsorted(list_obj_keys(s3prefix, bucket), alg=ns.IC|ns.INT)
    fnum = 1
    for obj_key in obj_keys:
        if nb_intro_pages > 0 and (obj_key.endswith(ilname+"0001.tif") or obj_key.endswith(ilname+"0002.tif")):
            # skip scan requests
            continue
        obj_key_afterprefix = obj_key[len(s3prefix):]
        obj_key_afterprefix = sanitize_fname_for_archive(obj_key_afterprefix, fnum+nb_intro_pages)
        dest_fname = dst_dir+obj_key_afterprefix
        if prefix:
            dest_fname = dst_dir+prefix+"_"+obj_key_afterprefix
        if not os.path.exists(os.path.dirname(dest_fname)):
            os.makedirs(os.path.dirname(dest_fname))
        S3.download_file(bucket, obj_key, dest_fname)
        fnum += 1
    # return the number of files
    return fnum - 1

def download_folder_into(s3prefix, dst_dir, bucket=BUCKET_NAME):
    for obj_key in list_obj_keys(s3prefix, bucket):
        if obj_key.endswith("/"):
            # some upload software use a 0 size file to create directories
            continue
        obj_key_afterprefix = obj_key[len(s3prefix):]
        dest_fname = dst_dir+obj_key_afterprefix
        if not os.path.exists(os.path.dirname(dest_fname)):
            os.makedirs(os.path.dirname(dest_fname))
        S3.download_file(bucket, obj_key, dest_fname)

def get_nbintropages(wlname, ilname):
    global WINFOS_CACHE
    if wlname not in WINFOS_CACHE:
        WINFOS_CACHE[wlname] = get_buda_scan_info(wlname)
    winfo = WINFOS_CACHE[wlname]
    if ilname not in winfo["image_groups"]:
        return 0
    iginfo = winfo["image_groups"][ilname]
    if "volume_pages_bdrc_intro" in iginfo:
        logging.info("found %d intro pages for %s" % (iginfo["volume_pages_bdrc_intro"], ilname))
        return iginfo["volume_pages_bdrc_intro"]
    return 0

# -------------------------
# Resolution / grouping helpers
# -------------------------

def _get_image_max_dim(path):
    # Open lazily; PIL won't decode pixels until needed; just want size
    with Image.open(path) as im:
        return max(im.width, im.height)

def _scan_folder_dims(files, quantize=64):
    """
    Returns a list of (file, max_dim, qdim) where qdim is quantized max_dim.
    Non-images are filtered out by caller.
    """
    out = []
    for f in files:
        try:
            md = _get_image_max_dim(f)
            qd = (md // quantize) * quantize
            out.append((f, md, qd))
        except Exception as e:
            logging.warning("Could not read image size for %s: %s", f, e)
    return out

def _has_meaningful_variation(dims, std_log_thresh=0.15):
    """
    Quick test: compute stddev of log(max_dim).
    If small, images are effectively uniform; keep single-factor path.
    """
    if not dims:
        return False
    logs = [math.log(maxd) for (_, maxd, _) in dims]
    if len(logs) < 2:
        return False
    sd = statistics.pstdev(logs)
    return sd >= std_log_thresh

def _segment_consecutive_groups(dims, break_ratio=1.25, min_run_len=3):
    """
    Segment consecutive files into groups by jumps in quantized max_dim.

    - break if qdim_{i+1} / qdim_i >= break_ratio OR <= 1/break_ratio
    - enforce min_run_len to avoid overfragmentation (hysteresis)
    Returns: list of groups, each = list of file paths
    """
    if not dims:
        return []

    groups = []
    current = [dims[0][0]]
    current_len = 1
    last_qdim = dims[0][2]

    # candidates for a break we only commit if the upcoming run reaches min_run_len
    pending_break_idx = None
    pending_run_len = 0

    for i in range(1, len(dims)):
        path, _, qdim = dims[i]
        ratio = (qdim + 1e-9) / (last_qdim + 1e-9)  # guard div by zero

        # detect potential break if the jump is large enough
        is_breaky = (ratio >= break_ratio) or (ratio <= (1.0 / break_ratio))

        if is_breaky:
            # start (or continue) a pending new run
            pending_run_len += 1
            if pending_break_idx is None:
                pending_break_idx = i  # where the new run begins
        else:
            # break streak interrupted; merge pending run back into current
            pending_break_idx = None
            pending_run_len = 0

        # if the new run is stable enough, we commit the break
        if pending_break_idx is not None and pending_run_len >= (min_run_len - 1):
            # commit current group up to pending_break_idx-1
            groups.append(current)
            # start new group from pending_break_idx
            current = [dims[pending_break_idx][0]]
            # also include any following items up to i
            for j in range(pending_break_idx + 1, i + 1):
                current.append(dims[j][0])
            # reset pending
            pending_break_idx = None
            pending_run_len = 0
            last_qdim = qdim
        else:
            # keep accumulating
            current.append(path)
            current_len += 1
            last_qdim = qdim

    if current:
        groups.append(current)

    # Merge tiny leading/trailing groups into neighbors to avoid noise
    cleaned = []
    for g in groups:
        if cleaned and len(g) < max(2, min_run_len - 1):
            cleaned[-1].extend(g)  # merge into previous
        else:
            cleaned.append(g)

    return cleaned

def get_group_shrink_factors(groups, base_shrink_factor=1.0, sample_size=3, quality=85):
    """
    Compute a shrink factor per group using existing get_shrink_factor_for_files.
    Returns: dict {file_path: shrink_factor}
    """
    mapping = {}
    for idx, g in enumerate(groups, 1):
        sf = get_shrink_factor_for_files(g, base_shrink_factor, sample_size=sample_size, quality=quality)
        logging.info("Group %d: %d files -> shrink_factor=%.4f", idx, len(g), sf)
        for f in g:
            mapping[f] = sf
    return mapping

# -------------------------
# Your existing helpers (light edits)
# -------------------------

def get_shrink_factor_one_img(img_pil, base_shrink_factor=1.0, max_size=800, step=0.1,
                              target_max_dimension=3500, quality=85):
    """
    get a good shrink factor for one image
    """
    shrink_factor = base_shrink_factor
    max_dimension = max(img_pil.width, img_pil.height)
    # only downscale if meaningfully larger than target
    if max_dimension > target_max_dimension and (target_max_dimension / max_dimension) < (1 - step):
        shrink_factor = min(shrink_factor, target_max_dimension / max_dimension)
    img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
    while len(img_bytes) > max_size * 1024:
        shrink_factor = (1 - step) * shrink_factor
        img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
    return shrink_factor

def get_shrink_factor_for_files(files, base_srink_factor, sample_size=3, quality=85):
    sample_paths = random.sample(files, min(sample_size, len(files)))
    sample_shrink_factors = []
    for sample_path in sample_paths:
        with Image.open(sample_path) as img_pil:
            sample_shrink_factors.append(
                get_shrink_factor_one_img(img_pil, base_srink_factor, quality=quality)
            )
    return statistics.mean(sample_shrink_factors)

# -------------------------
# Patched encode_folder with auto-grouping
# -------------------------

def encode_folder(archive_folder, images_folder, ilname, orig_shrink_factor=1.0,
                  lum_factor=1.0, quality=85, harmonize_sf=False,
                  auto_group=True, std_log_thresh=0.15, break_ratio=1.25,
                  min_run_len=3, quantize=64, sample_size=3):
    files = glob(archive_folder + '/**/*', recursive=True)
    if len(files) == 0:
        logging.error("no file to encode in %s", archive_folder)
        return

    Path(images_folder).mkdir(parents=True, exist_ok=True)
    files = sorted(files)

    # Keep only images for grouping/analysis
    img_files = [f for f in files if is_img(f)]
    if not img_files:
        logging.error("no image files to encode in %s", archive_folder)
        return

    # 1) auto grouping pre-check
    file_to_group_sf = None
    if auto_group:
        dims = _scan_folder_dims(img_files, quantize=quantize)
        multi = _has_meaningful_variation(dims, std_log_thresh=std_log_thresh)

        if multi:
            groups = _segment_consecutive_groups(dims, break_ratio=break_ratio, min_run_len=min_run_len)
            # ensure order is preserved inside each group (dims already follows sorted files)
            file_to_group_sf = get_group_shrink_factors(groups, base_shrink_factor=orig_shrink_factor,
                                                        sample_size=sample_size, quality=quality)
            logging.error("Detected multiple groups: %d groups", len(groups))
            # dump debug CSV in the images folder for inspection
            if DEBUG_CSV:
                debug_csv = f"{ilname}_grouping_debug.csv"
                dump_group_debug_csv(debug_csv, dims, groups, file_to_group_sf)
                logging.info("Wrote debug CSV to %s", debug_csv)
        else:
            logging.info("Uniform resolution set detected; using single shrink factor.")

    # 2) If not multi, compute a single shrink factor over all images (original behavior)
    if not file_to_group_sf:
        orig_shrink_factor = get_shrink_factor_for_files(img_files, orig_shrink_factor, quality=quality)
        logging.info("computed shrink factor %f for %s", orig_shrink_factor, archive_folder)

    # 3) Encode loop (mostly your original code)
    for file in files:
        if not is_img(file):
            logging.error("%s likely not an image" % file)
            continue

        rel = file[len(archive_folder):]
        filenoext = rel[:rel.rfind(".")]
        last4 = filenoext[-4:]

        if not OVERWRITE_IMG_FILES:
            file_exists = False
            for ext in [".jpg", ".tif"]:
                dst_path = Path(images_folder) / Path(ilname + last4 + ext)
                if dst_path.is_file():
                    file_exists = True
                    break
            if file_exists:
                continue

        img_bytes, ext, img_pil = None, None, None
        file_stats = os.stat(file)
        lastfour = file[-4:].lower()

        with open(file, "rb") as f:
            img_bytes = f.read()
        img_pil = Image.open(io.BytesIO(img_bytes))

        try:
            if (lastfour == ".jpg" or lastfour == "jpeg") and file_stats.st_size < 800 * 1024:
                ext = ".jpg"
                img_bytes = mozjpeg_lossless_optimization.optimize(img_bytes)
            elif (lastfour == ".tif" or lastfour == "tiff") and file_stats.st_size < 800 * 1024 and img_pil.mode == "1" and img_pil.info.get('compression', 'None') == "group4":
                ext = ".tif"
            else:
                # choose which shrink factor to start with
                if file_to_group_sf:
                    shrink_factor = file_to_group_sf[file]
                else:
                    shrink_factor = orig_shrink_factor

                img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality, lum_factor=lum_factor)
                while len(img_bytes) > 1200 * 1024:
                    shrink_factor = 0.8 * shrink_factor
                    img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality, lum_factor=lum_factor)

                # If we deviated and harmonization is off, reset for next files
                if file_to_group_sf:
                    target_sf = file_to_group_sf[file]
                else:
                    target_sf = orig_shrink_factor

                if abs(target_sf - shrink_factor) > 1e-6:
                    logging.warning("had to use %f instead of %f on %s", shrink_factor, target_sf, rel)
                    if not harmonize_sf:
                        shrink_factor = target_sf  # only affects potential reuse; current bytes already OK

        finally:
            img_pil.close()

        dst_path = Path(images_folder) / Path(ilname + last4 + ext)
        with dst_path.open("wb") as f:
            f.write(img_bytes)

def download_prefix(argslist):
    dst_dir, s3prefix, wlname, ilname, shrink_factor, lum_factor = argslist[0], argslist[1], argslist[2], argslist[3], argslist[4], argslist[5]
    prefix = None
    if '-' in ilname and not ilname.endswith('-'):
        ilnameparts = ilname.split('-')
        ilname = ilnameparts[0]
        prefix = ilnameparts[1]
    sources_dir = dst_dir + wlname+"/sources/"+wlname+"-"+ilname+"/"
    if not s3prefix.endswith(wlname+"-"+ilname+"/"):
        lastpart = s3prefix
        wilnameidx = s3prefix.rfind(wlname+"-"+ilname+"/") 
        if wilnameidx != -1:
            lastpart = s3prefix[wilnameidx+len(wlname+"-"+ilname+"/"):]
        else:
            wilnameidx = s3prefix.rfind(wlname+"/")
            if wilnameidx != -1:
                lastpart = lastpart[wilnameidx+len(wlname+"/"):]
        if lastpart.startswith("sources/"):
            lastpart = lastpart[8:]
        elif lastpart.startswith("archive/"):
            lastpart = lastpart[8:]
        elif lastpart.startswith("images/"):
            lastpart = lastpart[7:]
        if len(lastpart) > 0:
            sources_dir += lastpart
    archive_dir = dst_dir + wlname+"/archive/"+wlname+"-"+ilname+"/"
    images_dir = dst_dir + wlname+"/images/"+wlname+"-"+ilname+"/"
    nbintropages = get_nbintropages(wlname, ilname)
    if DOWNLOAD_FROM_S3:
        download_folder_into(s3prefix, sources_dir)
        download_folder_into("scam_logs/"+s3prefix, sources_dir)
        nb_archive_imgs = download_archive_folder_into("scam_cropped/"+s3prefix, archive_dir, nbintropages, ilname, prefix)
        if nb_archive_imgs < 1:
            logging.warning("%s-%s has no archive or image files" % (wlname, ilname))
            return [s3prefix, "noarchive"]
    encode_folder(archive_dir, images_dir, ilname, shrink_factor, lum_factor)
    if nbintropages > 0:
        shutil.copyfile("tbrcintropages/1.tif", archive_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", archive_dir+ilname+"0002.tif")
        shutil.copyfile("tbrcintropages/1.tif", images_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", images_dir+ilname+"0002.tif")
    return [s3prefix, "ok"]


def postprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    dest_dir = "./"
    if len(sys.argv) > 2:
        dest_dir = sys.argv[2]
        if not dest_dir.endswith("/"):
            dest_dir += "/"

    normalized_todo_lines = []

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            wlname = row[1]
            ilname = row[2]
            shrink_factor = 1.0
            lum_factor = 1.0
            if len(row) > 3 and row[3]:
                shrink_factor = float(row[3])
            normalized_todo_lines.append([dest_dir, folder, wlname, ilname, shrink_factor, lum_factor])

    for tl in tqdm(normalized_todo_lines):
        download_prefix(tl)
    #filesuffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    #ex = ParallelTaskExecutor(normalized_todo_lines, "done-process-"+filesuffix+".csv", download_prefix)
    #ex.run()

if __name__ == '__main__':
    postprocess_csv()
