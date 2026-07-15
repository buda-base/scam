import os
from hashlib import sha256
import boto3
import io
import botocore
import gzip
import pickle
import json
import threading
from concurrent.futures import ThreadPoolExecutor

BUCKET_NAME = "image-processing.bdrc.io"

VERSION = "0.0.1"

SESSION = boto3.Session(profile_name='image_processing')
S3 = SESSION.client('s3')

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

def gets3blob(s3Key, bucket=BUCKET_NAME, prefetcher=None):
    if prefetcher is not None:
        return prefetcher.get(s3Key)
    f = io.BytesIO()
    try:
        S3.download_fileobj(bucket, s3Key, f)
        return f
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None
        else:
            raise


class S3Prefetcher:
    """Download S3 objects on background threads ahead of consumption."""

    def __init__(self, bucket=BUCKET_NAME, max_workers=3):
        self.bucket = bucket
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._futures = {}
        self._lock = threading.Lock()

    def _download(self, s3_key):
        f = io.BytesIO()
        try:
            S3.download_fileobj(self.bucket, s3_key, f)
            return f
        except botocore.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return None
            raise

    def prefetch(self, s3_key):
        with self._lock:
            if s3_key not in self._futures:
                self._futures[s3_key] = self._executor.submit(self._download, s3_key)

    def schedule(self, s3_keys):
        for s3_key in s3_keys:
            self.prefetch(s3_key)

    def get(self, s3_key):
        with self._lock:
            if s3_key not in self._futures:
                self._futures[s3_key] = self._executor.submit(self._download, s3_key)
            future = self._futures.pop(s3_key)
        return future.result()

    def close(self):
        self._executor.shutdown(wait=True)

def get_sha256(b):
    return sha256(b).hexdigest()

def upload_to_s3(data, s3_key):
    return S3.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=data)

def get_gzip_picked_bytes(o):
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb") as f:
        pickle.dump(o, f)
    return out.getvalue()

def s3key_exists(s3_key):
    try:
        S3.head_object(Bucket=BUCKET_NAME, Key=s3_key)
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == "404":
            return False
        else:
            return False # ?
    return True

def is_img(path: str) -> bool:
    """"
    Better to use try: Image.open() but this is faster)
    """
    end4 = os.path.splitext(path)
    if len(end4) < 2:
        return False
    return end4[1].lower() in [".jpg", ".jpeg", ".tif", ".tiff", ".cr2", ".nef", ".arw", ".jp2", ".jxl"]

def list_obj_keys(prefix, bucket=BUCKET_NAME):
    obj_keys = []
    continuation_token = None
    while True:
        if continuation_token:
            response = S3.list_objects_v2(Bucket=bucket, Prefix=prefix, ContinuationToken=continuation_token)
        else:
            response = S3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        if 'Contents' in response and response['Contents']:
            for obj in response['Contents']:
                obj_key = obj['Key']
                obj_keys.append(obj_key)
        continuation_token = response.get("NextContinuationToken")
        if not continuation_token:
            break
    return obj_keys

def list_img_keys(prefix, bucket=BUCKET_NAME):
    obj_keys = list_obj_keys(prefix, bucket)
    obj_keys.sort()
    return filter(is_img, obj_keys)

def list_img_local(path: str) ->filter:
    obj_keys:[str] = []
    for afile in os.scandir(path):
        if afile.is_file():
            obj_keys.append(afile.path)
    obj_keys.sort()
    return filter(is_img, obj_keys)


MAX_SIZE = 1024
POINTS_PER_SIDE = 8

def s3_img_key_to_s3_pickle_key(img_s3_key, dots_per_side=8, pre_rotate=0):
    rotatestr = "" if pre_rotate == 0 else "_"+str(pre_rotate)
    suffix = "_sam_"+str(MAX_SIZE)+"_"+str(dots_per_side)+("%s.pickle.gz" % rotatestr)
    if "/images/" in img_s3_key:
        return img_s3_key.replace("/images/", "/images_tmp_pickle/") + suffix
    return img_s3_key.replace("/sources/", "/archive/") + suffix 

def split_s3_path(s3_path):
    path_parts=s3_path.replace("s3://","").split("/")
    bucket=path_parts.pop(0)
    key="/".join(path_parts)
    return bucket, key