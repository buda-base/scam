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

WINFOS_CACHE = {}

def sanitize_fname_for_archive(fpath, imgnum):
    fpath = fpath.replace("/", "_")
    suffix = "%04d" % imgnum
    fpathnoext = fpath[:fpath.rfind(".")]
    if not fpathnoext.endswith(suffix):
        fpath = fpathnoext+"_"+suffix+fpath[fpath.rfind("."):]
    return fpath

def download_archive_folder_into(s3prefix, dst_dir, nb_intro_pages, bucket=BUCKET_NAME):
    obj_keys = natsorted(list_obj_keys(s3prefix, bucket), alg=ns.IC|ns.INT)
    for fnum, obj_key in enumerate(obj_keys):
        obj_key_afterprefix = obj_key[len(s3prefix):]
        obj_key_afterprefix = sanitize_fname_for_archive(obj_key_afterprefix, fnum+nb_intro_pages)
        dest_fname = dst_dir+obj_key_afterprefix
        if not os.path.exists(os.path.dirname(dest_fname)):
            os.makedirs(os.path.dirname(dest_fname))
        S3.download_file(bucket, obj_key, dest_fname)

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
        logging.error("found %d intro pages for %s" % (iginfo["volume_pages_bdrc_intro"], ilname))
        return iginfo["volume_pages_bdrc_intro"]
    return 0

def encode_folder(archive_folder, images_folder, ilname, shrink_factor=1.0, quality=85):
    files = glob(archive_folder+'/**/*', recursive = True)
    Path(images_folder).mkdir(parents=True, exist_ok=True)
    orig_shrink_factor = shrink_factor
    for file in files:
        if not is_img(file):
            logging.error("%s likely not an image" % file)
            continue
        file = file[len(archive_folder):]
        img = Image.open(archive_folder + file)
        img, ext = encode_img(img, shrink_factor=shrink_factor, quality=quality)
        while len(img) > 1024*1024:
            shrink_factor = 0.8*shrink_factor
            img, ext = encode_img(img, shrink_factor=shrink_factor, quality=quality)
        if orig_shrink_factor != shrink_factor:
            logging.warn("had to use %f instead of %f starting with %s" % (shrink_factor, orig_shrink_factor, file))
        filenoext = file[:file.rfind(".")]
        last4 = filenoext[-4:]
        dst_path = Path(images_folder) / Path(ilname+last4+ext)
        with dst_path.open("wb") as f:
            f.write(img)

def download_prefix(s3prefix, wlname, ilname, shrink_factor, dst_dir):
    sources_dir = wlname+"/sources/"+wlname+"-"+ilname+"/"
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
    archive_dir = wlname+"/archive/"+wlname+"-"+ilname+"/"
    images_dir = wlname+"/images/"+wlname+"-"+ilname+"/"
    download_folder_into(s3prefix, sources_dir)
    nbintropages = get_nbintropages(wlname, ilname)
    #download_archive_folder_into("scam_cropped/"+s3prefix, archive_dir, nbintropages)
    encode_folder(archive_dir, images_dir, ilname)
    if nbintropages > 0:
        shutil.copyfile("tbrcintropages/1.tif", archive_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", archive_dir+ilname+"0002.tif")
        shutil.copyfile("tbrcintropages/1.tif", images_dir+ilname+"0001.tif")
        shutil.copyfile("tbrcintropages/2.tif", images_dir+ilname+"0002.tif")


def postprocess_csv():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            folder = row[0]
            if not folder.endswith('/'):
                folder += "/"
            wlname = row[1]
            ilname = row[2]
            shrink_factor = 1.0
            if len(row) > 3:
                shrink_factor = float(row[3])
            download_prefix(folder, wlname, ilname, shrink_factor, "./")

if __name__ == '__main__':
    postprocess_csv()
