import boto3
import io
import botocore

BUCKET_NAME = "image-processing.bdrc.io"

SESSION = boto3.Session(profile_name='image_processing')
S3 = SESSION.client('s3')

def gets3blob(s3Key, bucket=BUCKET_NAME):
    f = io.BytesIO()
    try:
        S3.download_fileobj(bucket, s3Key, f)
        return f
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None
        else:
            raise

def upload_to_s3(data, s3_key):
    S3.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=data)

def get_gzip_picked_bytes(o):
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb") as f:
        pickle.dump(o, f)
    gzipped_pickled_bytes = out.getvalue()

def s3key_exists(s3_key):
    try:
        S3.head_object(Bucket=BUCKET_NAME, Key=s3_key)
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == "404":
            return False
        else:
            return False # ?
    return True

def is_img(path):
    end4 = path[-4:].lower()
    return end4 in [".jpg", "jpeg", ".tif", "tiff", ".cr2"]

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

MAX_SIZE = 1024
POINTS_PER_SIDE = 8

def s3_img_key_to_s3_pickle_key(img_s3_key):
    suffix = "_"+str(MAX_SIZE)+"_"+str(POINTS_PER_SIDE)+".pickle.gz"
    return img_s3_key.replace("/sources/", "/tmp-sam/") + suffix 

def split_s3_path(s3_path):
    path_parts=s3_path.replace("s3://","").split("/")
    bucket=path_parts.pop(0)
    key="/".join(path_parts)
    return bucket, key