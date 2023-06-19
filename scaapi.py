from datetime import datetime
from flask import Flask, json, request
import pickle
import gzip
from utils import upload_to_s3, gets3blob

from flask_cors import CORS

api = Flask("SCAM-QC", static_url_path='', static_folder='web/')
CORS(api)

VERSION = "0.0.1"

def get_gz_pickle(pickle_path):
    blob = gets3blob(pickle_path)
    if blob is None:
        return
    blob.seek(0)
    return pickle.loads(gzip.decompress(blob.read()))

def get_thumbnail_bytes(folder_path, thumbnail_path):
    """
    returns the bytes of the thumbnail
    """
    return gets3blob(thumbnail_path)

DEFAULT_SCAM_OPTIONS = {
    "alter_checked": False,
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

def run_scam_folder(folder_path, scam_options = DEFAULT_SCAM_OPTIONS):
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
        "scam_options": scam_options
    })
    for file_info in scam_json["files"]:
        if file_info["checked"] and not scam_options["alter_checked"]:
            continue
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
    upload_to_s3(scam_json_str.encode('utf-8'), json_file_path)

def get_scam_json(folder_path):
    json_file_path = folder_path+"scam.json"
    blob = gets3blob(pickle_path)
    if blob is None:
        return None
    blob.seek(0)
    return json.loads(blob.read().decode("utf-8"))

@api.route('/save_scam_json', methods=['POST'])
def save_scam_json_api():
    data = request.json
    folder_path = data.get('folder_path')
    scam_json_obj = data.get('scam_json_obj')

@api.route('/get_scam_json', methods=['POST'])
def get_scam_json_api():
    data = request.json
    folder_path = data.get('folder_path')
    return get_scam_json(folder_path)

@api.route('/run_scam_file', methods=['POST'])
def run_scam_file_api():
    data = request.json
    folder_path = data.get('folder_path')
    folder_path = data.get('file_info')
    folder_path = data.get('scam_options')
    return run_scam_image(folder_path, file_info, scam_options)

@api.route('/run_scam_folder', methods=['POST'])
def run_scam_folder_api():
    data = request.json
    folder_path = data.get('folder_path')
    folder_path = data.get('scam_options')
    return run_scam_folder(folder_path, scam_options)

if __name__ == '__main__':
    api.run()
