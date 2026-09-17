from utils import S3, BUCKET_NAME, list_obj_keys, is_img
from img_utils import encode_img
from image_decode import get_image_size_from_path, decode_path_to_pil
from openpecha.buda.api import get_buda_scan_info
import shutil
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    """
    Download archive images from S3. Returns (n_downloaded, diagnostics dict).
    """
    obj_keys = natsorted(list_obj_keys(s3prefix, bucket), alg=ns.IC|ns.INT)
    n_total = len(obj_keys)
    n_img = 0
    n_skipped_non_img = 0
    n_skipped_intro = 0
    ext_counts = {}
    sample_non_img = []
    fnum = 1
    for obj_key in obj_keys:
        ext = os.path.splitext(obj_key)[1].lower() or "(no ext)"
        ext_counts[ext] = ext_counts.get(ext, 0) + 1
        if not is_img(obj_key):
            n_skipped_non_img += 1
            if len(sample_non_img) < 5:
                sample_non_img.append(obj_key)
            continue
        n_img += 1
        if nb_intro_pages > 0 and (obj_key.endswith(ilname+"0001.tif") or obj_key.endswith(ilname+"0002.tif")):
            # skip scan requests
            n_skipped_intro += 1
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
    n_downloaded = fnum - 1
    diag = {
        "s3_prefix": s3prefix,
        "s3_bucket": bucket,
        "n_keys_listed": n_total,
        "n_keys_is_img": n_img,
        "n_skipped_non_img": n_skipped_non_img,
        "n_skipped_intro": n_skipped_intro,
        "n_downloaded": n_downloaded,
        "ext_counts": ext_counts,
        "sample_non_img_keys": sample_non_img,
        "sample_keys": obj_keys[:5],
    }
    return n_downloaded, diag

def _local_archive_diagnostics(archive_dir):
    """Inspect a local archive dir; returns diagnostics dict including n_images."""
    diag = {
        "archive_dir": archive_dir,
        "dir_exists": os.path.isdir(archive_dir),
        "n_files": 0,
        "n_images": 0,
        "ext_counts": {},
        "sample_files": [],
        "sample_rejected": [],
    }
    if not diag["dir_exists"]:
        parent = os.path.dirname(archive_dir.rstrip("/"))
        diag["parent_exists"] = os.path.isdir(parent)
        if diag["parent_exists"]:
            try:
                diag["parent_listing"] = sorted(os.listdir(parent))[:20]
            except OSError as e:
                diag["parent_listing_error"] = str(e)
        return diag
    for f in glob(archive_dir + '/**/*', recursive=True):
        if not os.path.isfile(f):
            continue
        diag["n_files"] += 1
        ext = os.path.splitext(f)[1].lower() or "(no ext)"
        diag["ext_counts"][ext] = diag["ext_counts"].get(ext, 0) + 1
        if len(diag["sample_files"]) < 5:
            diag["sample_files"].append(f)
        if is_img(f):
            diag["n_images"] += 1
        elif len(diag["sample_rejected"]) < 5:
            diag["sample_rejected"].append(f)
    return diag

def _count_local_archive_images(archive_dir):
    return _local_archive_diagnostics(archive_dir)["n_images"]

def _format_no_archive_warning(wlname, ilname, *, mode, archive_dir, s3prefix=None, diag=None):
    """Build an explicit multi-line warning when no archive images were found."""
    lines = [
        f"{wlname}-{ilname}: no archive images to process",
        f"  mode: {mode}",
        f"  expected local archive_dir: {archive_dir}",
        f"  DOWNLOAD_FROM_S3={DOWNLOAD_FROM_S3}",
        f"  is_img() accepts: .jpg .jpeg .tif .tiff .cr2 .nef .arw .jp2 .jxl",
    ]
    if s3prefix is not None:
        lines.append(f"  s3 archive prefix: s3://{BUCKET_NAME}/{s3prefix}")
    if diag:
        for k, v in diag.items():
            if k in ("archive_dir", "s3_prefix", "s3_bucket"):
                continue
            lines.append(f"  {k}: {v}")
    return "\n".join(lines)

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
    # Prefer libvips header so JPEG-XL archives work without a full file read
    w, h = get_image_size_from_path(path)
    return max(w, h)

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
                              target_max_dimension=3500, quality=85, orig_max_dimension=None):
    """
    get a good shrink factor for one image, relative to the original max dimension.

    img_pil may already be shrink-on-load decoded; pass orig_max_dimension in that case.
    """
    shrink_factor = base_shrink_factor
    decoded_max = max(img_pil.width, img_pil.height)
    orig_max = orig_max_dimension if orig_max_dimension else decoded_max
    already_applied = decoded_max / orig_max if orig_max else 1.0
    # only downscale if meaningfully larger than target
    if orig_max > target_max_dimension and (target_max_dimension / orig_max) < (1 - step):
        shrink_factor = min(shrink_factor, target_max_dimension / orig_max)
    remaining = shrink_factor / already_applied if already_applied > 0 else shrink_factor
    img_bytes, ext = encode_img(img_pil, shrink_factor=remaining, quality=quality)
    while len(img_bytes) > max_size * 1024:
        shrink_factor = (1 - step) * shrink_factor
        remaining = shrink_factor / already_applied if already_applied > 0 else shrink_factor
        img_bytes, ext = encode_img(img_pil, shrink_factor=remaining, quality=quality)
    return shrink_factor

def get_shrink_factor_for_files(files, base_srink_factor, sample_size=3, quality=85):
    sample_paths = random.sample(files, min(sample_size, len(files)))
    sample_shrink_factors = []
    for sample_path in sample_paths:
        orig_w, orig_h = get_image_size_from_path(sample_path)
        orig_max = max(orig_w, orig_h)
        target_max = 3500
        max_dimension = None
        if orig_max > target_max and (target_max / orig_max) < 0.9:
            max_dimension = target_max
        img_pil = decode_path_to_pil(sample_path, max_dimension=max_dimension)
        try:
            sample_shrink_factors.append(
                get_shrink_factor_one_img(
                    img_pil, base_srink_factor, quality=quality, orig_max_dimension=orig_max
                )
            )
        finally:
            img_pil.close()
    return statistics.mean(sample_shrink_factors)


def _is_jpeg_path(path):
    lastfour = path[-4:].lower()
    return lastfour == ".jpg" or lastfour == "jpeg"


def _is_tiff_path(path):
    lastfour = path[-4:].lower()
    return lastfour == ".tif" or lastfour == "tiff"


def _tiff_is_small_g4(path, file_size):
    if file_size >= 800 * 1024 or not _is_tiff_path(path):
        return False
    try:
        with Image.open(path) as im:
            return im.mode == "1" and im.info.get("compression", "None") == "group4"
    except Exception:
        return False

# -------------------------
# Patched encode_folder with auto-grouping
# -------------------------

def encode_folder(archive_folder, images_folder, ilname, orig_shrink_factor=1.0,
                  lum_factor=1.0, quality=85, harmonize_sf=False,
                  auto_group=True, std_log_thresh=0.15, break_ratio=1.25,
                  min_run_len=3, quantize=64, sample_size=3, workers=1):
    files = glob(archive_folder + '/**/*', recursive=True)
    if len(files) == 0:
        logging.error("no file to encode in %s", archive_folder)
        return

    Path(images_folder).mkdir(parents=True, exist_ok=True)
    files = sorted(files)

    # Keep only images for grouping/analysis
    img_files = [f for f in files if is_img(f)]
    if not img_files:
        diag = _local_archive_diagnostics(archive_folder)
        logging.error(
            "no image files to encode in %s\n%s",
            archive_folder,
            _format_no_archive_warning(
                "?",
                "?",
                mode="encode_folder",
                archive_dir=archive_folder,
                diag=diag,
            ),
        )
        return

    for f in files:
        if not is_img(f):
            logging.error("%s likely not an image" % f)

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

    def _encode_one(file):
        rel = file[len(archive_folder):]
        filenoext = rel[:rel.rfind(".")]
        last4 = filenoext[-4:]

        if not OVERWRITE_IMG_FILES:
            for existing_ext in [".jpg", ".tif"]:
                dst_path = Path(images_folder) / Path(ilname + last4 + existing_ext)
                if dst_path.is_file():
                    return

        file_stats = os.stat(file)
        file_size = file_stats.st_size
        img_bytes = None
        ext = None
        img_pil = None

        try:
            if _is_jpeg_path(file):
                with open(file, "rb") as f:
                    img_bytes = f.read()
                img_bytes = mozjpeg_lossless_optimization.optimize(
                    img_bytes, copy=mozjpeg_lossless_optimization.COPY_MARKERS.ICC
                )
                file_size = len(img_bytes)
                if file_size < 1200 * 1024:
                    ext = ".jpg"
                    logging.info("not reencoding %s" % file)
                    dst_path = Path(images_folder) / Path(ilname + last4 + ext)
                    with dst_path.open("wb") as f:
                        f.write(img_bytes)
                    return

            if _tiff_is_small_g4(file, file_stats.st_size):
                with open(file, "rb") as f:
                    img_bytes = f.read()
                ext = ".tif"
                dst_path = Path(images_folder) / Path(ilname + last4 + ext)
                with dst_path.open("wb") as f:
                    f.write(img_bytes)
                return

            if file_to_group_sf:
                target_sf = file_to_group_sf[file]
            else:
                target_sf = orig_shrink_factor

            orig_w, orig_h = get_image_size_from_path(file)
            orig_max = max(orig_w, orig_h)
            decode_sf = target_sf
            max_dimension = None
            if decode_sf < 1.0 - 1e-6 and orig_max > 1:
                max_dimension = max(1, int(round(orig_max * decode_sf)))
            img_pil = decode_path_to_pil(file, max_dimension=max_dimension)
            already_applied = max(img_pil.width, img_pil.height) / orig_max if orig_max else 1.0
            remaining = 1.0
            if already_applied > 0 and abs(already_applied - decode_sf) > 1e-3 and decode_sf < already_applied:
                remaining = decode_sf / already_applied

            applied_sf = already_applied * remaining
            img_bytes, ext = encode_img(
                img_pil, shrink_factor=remaining, quality=quality, lum_factor=lum_factor
            )
            while len(img_bytes) > 1200 * 1024:
                remaining = 0.8 * remaining
                applied_sf = already_applied * remaining
                img_bytes, ext = encode_img(
                    img_pil, shrink_factor=remaining, quality=quality, lum_factor=lum_factor
                )

            if abs(target_sf - applied_sf) > 1e-6:
                logging.warning("had to use %f instead of %f on %s", applied_sf, target_sf, rel)

            dst_path = Path(images_folder) / Path(ilname + last4 + ext)
            with dst_path.open("wb") as f:
                f.write(img_bytes)
        finally:
            if img_pil is not None:
                img_pil.close()

    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_encode_one, f): f for f in img_files}
            for future in tqdm(as_completed(futures), total=len(futures), desc="encode"):
                future.result()
    else:
        for file in tqdm(img_files, desc="encode"):
            _encode_one(file)

def download_prefix(argslist, workers=1):
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
        s3_archive_prefix = "scam_cropped/"+s3prefix
        nb_archive_imgs, s3_diag = download_archive_folder_into(
            s3_archive_prefix, archive_dir, nbintropages, ilname, prefix
        )
        if nb_archive_imgs < 1:
            # Also describe whatever is already on disk (helps when S3 is empty
            # but a previous local archive exists elsewhere / under another path).
            local_diag = _local_archive_diagnostics(archive_dir)
            logging.warning(
                _format_no_archive_warning(
                    wlname,
                    ilname,
                    mode="download from S3 (0 image keys downloaded)",
                    archive_dir=archive_dir,
                    s3prefix=s3_archive_prefix,
                    diag={**s3_diag, "local_after_download": local_diag},
                )
            )
            return [s3prefix, "noarchive"]
    else:
        local_diag = _local_archive_diagnostics(archive_dir)
        if local_diag["n_images"] < 1:
            logging.warning(
                _format_no_archive_warning(
                    wlname,
                    ilname,
                    mode="local archive only (DOWNLOAD_FROM_S3=False)",
                    archive_dir=archive_dir,
                    diag=local_diag,
                )
            )
            return [s3prefix, "noarchive"]
    encode_folder(archive_dir, images_dir, ilname, shrink_factor, lum_factor, workers=workers)
    if nbintropages > 0:
        shutil.copyfile("tbrcintropages/1.tif", archive_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", archive_dir+ilname+"0002.tif")
        shutil.copyfile("tbrcintropages/1.tif", images_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", images_dir+ilname+"0002.tif")
    return [s3prefix, "ok"]


def postprocess_csv():
    parser = argparse.ArgumentParser(description="Download SCAM archives and encode delivery JPEGs")
    parser.add_argument("csv", help="path to the CSV file listing volumes to process")
    parser.add_argument("dest_dir", nargs="?", default="./", help="output root directory (default: ./)")
    parser.add_argument("--workers", type=int, default=1, metavar="N",
                        help="parallel encode threads per volume (default: 1)")
    args = parser.parse_args()

    dest_dir = args.dest_dir
    if not dest_dir.endswith("/"):
        dest_dir += "/"

    normalized_todo_lines = []

    with open(args.csv, newline='') as csvfile:
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

    for tl in tqdm(normalized_todo_lines, desc="volumes"):
        download_prefix(tl, workers=args.workers)
    #filesuffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    #ex = ParallelTaskExecutor(normalized_todo_lines, "done-process-"+filesuffix+".csv", download_prefix)
    #ex.run()

if __name__ == '__main__':
    postprocess_csv()
