from utils import download_folder_into
from img_utils import encode_folder
from openpecha.buda.api import get_buda_scan_info
import shutil

WINFOS_CACHE = {}

def get_nbintropages(wlname, ilname):
    if wlname not in WINFOS_CACHE:
        WINFO_CACHE[wlname] = get_buda_scan_info(wlname)
    winfo = WINFOS_CACHE[wlname]
    if ilname not in winfo["image_groups"]:
        return 0
    iginfo = winfo["image_groups"][ilname]
    if "volume_pages_bdrc_intro" in iginfo:
        return iginfo["volume_pages_bdrc_intro"]
    return 0

def encode_folder(archive_folder, images_folder, ilname, shrink_factor=1.0, quality=85):
    files = glob(archive_folder+'/**/*', recursive = True)
    Path(images_folder).mkdir(parents=True, exist_ok=True)
    for file in files:
        if not likely_img(file):
            continue
        file = file[len(archive_folder):]
        img = Image.open(archive_folder + file)
        img, ext = encode_img(img, shrink_factor=shrink_factor, quality=quality)
        filenoext = file[:file.rfind(".")]
        last4 = filenoext[-4:]
        dst_path = Path(images_folder) / Path(ilname+last4+ext)
        with dst_path.open("wb") as f:
            f.write(img)

def download_prefix(s3prefix, wlname, ilname, shrink_factor, dst_dir):
    sources_dir = wlname+"/archive/"+wlname+"-"+ilname+"/"
    if not s3prefix.endswith(wlname+"-"+ilname+"/"):
        lastpart = s3prefix
        wilnameidx = s3prefix.rfind(wlname+"-"+ilname+"/") 
        if wilnameidx != -1:
            lastpart = s3prefix[wilnameidx:]
        else:
            wilnameidx = s3prefix.rfind(wlname+"/")
            if wilnameidx != -1:
                lastpart = s3prefix[wilnameidx:]
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
    download_archive_folder_into("scam_cropped/"+s3prefix, archive_dir, nbintropages)
    encode_folder(archive_dir, images_dir)
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
            download_folder(folder, wlname, ilname, shrink_factor, "./")

if __name__ == '__main__':
    postprocess_csv()
