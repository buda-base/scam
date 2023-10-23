from datetime import datetime
from flask import Flask, json, request, make_response, send_file
import pickle
import gzip
from utils import upload_to_s3, gets3blob
from sam_annotation_utils import add_scam_results
import logging

from flask_cors import CORS

api = Flask("SCAM-QC")
CORS(api)

VERSION = "0.0.1"

def get_gz_pickle(pickle_path):
    blob = gets3blob(pickle_path)
    if blob is None:
        return
    blob.seek(0)
    return pickle.loads(gzip.decompress(blob.read()))

def get_thumbnail_bytesio(thumbnail_path):
    """
    returns the bytes of the thumbnail
    """
    blob = gets3blob(thumbnail_path)
    blob.seek(0)
    return blob

DEFAULT_SCAM_OPTIONS = {
    "alter_checked": False,
    "direction": "vertical",
    "squarishness_min": 0.85,
    "squarishness_min_warn": 0.7,
    "nb_pages_expected": 2,
    "wh_ratio_range": [3.0, 7.0],
    "wh_ratio_range_warn": [1.5, 10.0],
    "area_ratio_range": [0.2, 0.5],
    "area_diff_max": 0.15,
    "area_diff_max_warn": 0.7,
    "use_rotation": True,
    "fixed_width": None,
    "fixed_height": None,
    "expand_to_fixed": False,
    "cut_at_fixed": False
}

def run_scam_folder(folder_path, scam_json, scam_options = DEFAULT_SCAM_OPTIONS):
    """
    runs scam on a complete scam.json file
    """
    scam_run_idx = len(scam_json["scam_runs"])
    scam_json["scam_runs"].append({
        "date": datetime.now().isoformat(),
        "version": VERSION,
        "scam_options": scam_options
    })
    for file_info in scam_json["files"]:
        if file_info.get("checked") and not scam_options["alter_checked"]:
            continue
        logging.info("run sam on %s" % file_info["img_path"])
        sam_anns = get_gz_pickle(file_info["pickle_path"])
        add_scam_results(file_info, sam_anns, scam_options)
    return scam_json

def run_scam_image(folder_path, file_info, scam_options):
    sam_anns = get_gz_pickle(file_info["pickle_path"])
    add_scam_results(file_info, sam_anns, scam_options)
    return file_info

def save_scam_json(folder_path, scam_json_obj):
    scam_json_str = json.dumps(scam_json_obj, indent=2)
    json_file_path = folder_path+"scam.json"
    return upload_to_s3(scam_json_str.encode('utf-8'), json_file_path)

def get_scam_json(folder_path):
    json_file_path = folder_path+"scam.json"
    blob = gets3blob(json_file_path)
    if blob is None:
        return None
    blob.seek(0)
    return json.loads(blob.read().decode("utf-8"))

@api.route('/save_scam_json', methods=['POST'])
def save_scam_json_api():
    data = request.json
    folder_path = data.get('folder_path')
    scam_json_obj = data.get('scam_json_obj')
    return save_scam_json(folder_path, scam_json_obj)

@api.route('/get_thumbnail_bytes', methods=['GET'])
def get_thumbnail_bytes_api_get():
    thumbnail_path = request.args.get('thumbnail_path')
    img_bytesio = get_thumbnail_bytesio(thumbnail_path)
    if img_bytesio is None:
        return None
    mt = "image/jpeg"
    if thumbnail_path.endswith("png"):
        mt = "image/png"
    return send_file(img_bytesio, mimetype=mt)

@api.route('/get_scam_json', methods=['POST'])
def get_scam_json_api():
    data = request.json
    folder_path = data.get('folder_path')
    res = get_scam_json(folder_path)
    if not res:
        return "could not find json", 404
    return res

@api.route('/run_scam_file', methods=['POST'])
def run_scam_file_api():
    data = request.json
    folder_path = data.get('folder_path')
    file_info = data.get('file_info')
    scam_options = data.get('scam_options')
    return run_scam_image(folder_path, file_info, scam_options)

@api.route('/run_scam', methods=['POST'])
def run_scam_api():
    data = request.json
    folder_path = data.get('folder_path')
    scam_options = data.get('scam_options')
    scam_json = data.get('scam_json')
    return run_scam_folder(folder_path, scam_json, scam_options)

if __name__ == '__main__':
    api.run(debug=False)
