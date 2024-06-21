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
import re

WINFOS_CACHE = {}

def parse_filename_im(filename):
    """Parse the filename into components: base, number, and suffix."""
    # Regular expression to match the required components
    match = re.match(r"([a-zA-Z0-9\W]*?)(\d{1,2})?(-[a-zA-Z]{3}-\d{4})", filename)
    if match:
        base = match.group(1)
        number = match.group(2)
        suffix = match.group(3)
        number = int(number) if number is not None else None
        return (base, number, suffix)
    else:
        print(f"Filename '{filename}' does not match the expected pattern.")
        return (filename)

def sort_key_im(filename):
    """Convert the parsed filename into a sort key."""
    base, number, suffix = parse_filename(filename)
    return (base.lower(), (number if number is not None else -1), suffix)

def sanitize_fname_for_archive(fpath, imgnum):
    fpath = fpath.replace("/", "_").replace(" ", "_").replace("'", "v").replace('"', "")
    fpath = re.replace(r"-\d{4}\.tif", ".tif", fpath)
    suffix = "%04d" % imgnum
    fpathnoext = fpath[:fpath.rfind(".")]
    if not fpathnoext.endswith(suffix):
        fpath = fpathnoext+"_"+suffix+fpath[fpath.rfind("."):]
    return fpath

def download_archive_folder_into(s3prefix, dst_dir, nb_intro_pages, ilname, bucket=BUCKET_NAME):
    obj_keys = sorted(list_obj_keys(s3prefix, bucket), key=sort_key_im)
    fnum = 1
    for obj_key in obj_keys:
        if nb_intro_pages > 0 and (obj_key.endswith(ilname+"0001.tif") or obj_key.endswith(ilname+"0002.tif")):
            # skip scan requests
            continue
        obj_key_afterprefix = obj_key[len(s3prefix):]
        obj_key_afterprefix = sanitize_fname_for_archive(obj_key_afterprefix, fnum+nb_intro_pages)
        dest_fname = dst_dir+obj_key_afterprefix
        if not os.path.exists(os.path.dirname(dest_fname)):
            os.makedirs(os.path.dirname(dest_fname))
        S3.download_file(bucket, obj_key, dest_fname)
        fnum += 1
    # return the number of files
    return fnum - 1

def download_folder_into(s3prefix, dst_dir, bucket=BUCKET_NAME):
    for obj_key in list_obj_keys(s3prefix, bucket):
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

def encode_folder(archive_folder, images_folder, ilname, shrink_factor=1.0, quality=85, harmonize_sf=False):
    files = glob(archive_folder+'/**/*', recursive = True)
    Path(images_folder).mkdir(parents=True, exist_ok=True)
    orig_shrink_factor = shrink_factor
    for file in files:
        if not is_img(file):
            logging.error("%s likely not an image" % file)
            continue
        file = file[len(archive_folder):]
        img_bytes, ext = None, None
        file_stats = os.stat(archive_folder + file)
        if file[-4] == ".jpg" and file_stats.st_size < 800*1024:
            ext = ".jpg"
            with open(archive_folder + file, "rb") as f:
                img_bytes = f.read()
        else:
            img_pil = Image.open(archive_folder + file)
            img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
            while len(img_bytes) > 800*1024:
                shrink_factor = 0.8*shrink_factor
                img_bytes, ext = encode_img(img_pil, shrink_factor=shrink_factor, quality=quality)
            img_pil = None
            if orig_shrink_factor != shrink_factor:
                logging.warning("had to use %f instead of %f on %s" % (shrink_factor, orig_shrink_factor, file))
                if not harmonize_sf:
                    shrink_factor = orig_shrink_factor
        filenoext = file[:file.rfind(".")]
        last4 = filenoext[-4:]
        dst_path = Path(images_folder) / Path(ilname+last4+ext)
        with dst_path.open("wb") as f:
            f.write(img_bytes)

def download_prefix(s3prefix, wlname, ilname, shrink_factor, dst_dir):
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
    #download_folder_into(s3prefix, sources_dir)
    download_folder_into("scam_logs/"+s3prefix, sources_dir)
    nbintropages = get_nbintropages(wlname, ilname)
    nb_archive_imgs = download_archive_folder_into("scam_cropped/"+s3prefix, archive_dir, nbintropages, ilname)
    if nb_archive_imgs < 1:
        logging.warning("%s-%s has no archive or image files" % (wlname, ilname))
        return
    encode_folder(archive_dir, images_dir, ilname)
    if nbintropages > 0:
        shutil.copyfile("tbrcintropages/1.tif", archive_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", archive_dir+ilname+"0002.tif")
        shutil.copyfile("tbrcintropages/1.tif", images_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", images_dir+ilname+"0002.tif")


def postprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    dest_dir = "./"
    if len(sys.argv) > 2:
        dest_dir = sys.argv[2]
        if not dest_dir.endswith("/"):
            dest_dir += "/"

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            wlname = row[1]
            ilname = row[2]
            shrink_factor = 0.4
            if len(row) > 3:
                shrink_factor = float(row[3])
            download_prefix(folder, wlname, ilname, shrink_factor, dest_dir)

if __name__ == '__main__':
    postprocess_csv()
