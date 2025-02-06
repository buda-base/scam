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

WINFOS_CACHE = {}
DEFAULT_NBINTROPAGES = 0
DOWNLOAD_FROM_S3 = False
OVERWRITE_IMG_FILES = True

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

def get_shrink_factor_one_img(img_pil, base_shrink_factor=1.0, max_size=800, step=0.1, target_max_dimension=3500, quality=85):
    """
    get a good shrink factor for one image
    """
    shrink_factor = base_shrink_factor
    max_dimension = max(img_pil.width, img_pil.height)
    # we don't cut if it's too close to 1.0
    if max_dimension > target_max_dimension and (target_max_dimension / max_dimension) < (1-step):
        shrink_factor = min(shrink_factor, target_max_dimension / max_dimension)
    img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
    while len(img_bytes) > max_size*1024:
        shrink_factor = (1-step)*shrink_factor
        img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
    return shrink_factor

def get_shrink_factor_for_files(files, base_srink_factor, sample_size=3, quality=85):
    sample_paths = random.sample(files, min(sample_size, len(files)))
    sample_shrink_factors = []
    for sample_path in sample_paths:
        img_pil = Image.open(sample_path)
        sample_shrink_factors.append(get_shrink_factor_one_img(img_pil, base_srink_factor, quality=quality))
    return statistics.mean(sample_shrink_factors)

def encode_folder(archive_folder, images_folder, ilname, orig_shrink_factor=1.0, lum_factor=1.0, quality=85, harmonize_sf=False):
    files = glob(archive_folder+'/**/*', recursive = True)
    if len(files) == 0:
        logging.error("no file to encode in %s" % archive_folder)
        return
    Path(images_folder).mkdir(parents=True, exist_ok=True)
    files = sorted(files)
    orig_shrink_factor = get_shrink_factor_for_files(files, orig_shrink_factor, quality=quality)
    logging.info("computed shrink factor %f for %s" % (orig_shrink_factor, archive_folder))
    for file in files:
        if not is_img(file):
            logging.error("%s likely not an image" % file)
            continue
        file = file[len(archive_folder):]
        filenoext = file[:file.rfind(".")]
        last4 = filenoext[-4:]
        if not OVERWRITE_IMG_FILES:
            file_exists = False
            for ext in [".jpg", ".tif"]:
                dst_path = Path(images_folder) / Path(ilname+last4+ext)
                if dst_path.is_file():
                    file_exists = True
                    break
            if file_exists:
                continue
        img_bytes, ext, img_pil = None, None, None
        file_stats = os.stat(archive_folder + file)
        lastfour = file[-4:].lower()
        with open(archive_folder + file, "rb") as f:
            img_bytes = f.read()
            img_pil = Image.open(io.BytesIO(img_bytes))
        if (lastfour == ".jpg" or lastfour == "jpeg") and file_stats.st_size < 800*1024:
            ext = ".jpg"
            img_bytes = mozjpeg_lossless_optimization.optimize(img_bytes)
        elif (lastfour == ".tif" or lastfour == "tiff") and file_stats.st_size < 800*1024 and img_pil.mode == "1" and img_pil.info.get('compression', 'None') == "group4":
            ext = ".tif"
        else:
            shrink_factor = orig_shrink_factor
            img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality, lum_factor=lum_factor)
            while len(img_bytes) > 1200*1024:
                shrink_factor = 0.8*shrink_factor
                img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality, lum_factor=lum_factor)
            img_pil = None
            if orig_shrink_factor != shrink_factor:
                logging.warning("had to use %f instead of %f on %s" % (shrink_factor, orig_shrink_factor, file))
                if not harmonize_sf:
                    shrink_factor = orig_shrink_factor
        dst_path = Path(images_folder) / Path(ilname+last4+ext)
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
