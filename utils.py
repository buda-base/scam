import boto3
import io
import botocore

BUCKET_NAME = "image-processing.bdrc.io"

SESSION = boto3.Session(profile_name='image_processing')
S3 = SESSION.client('s3')

def gets3blob(s3Key):
    f = io.BytesIO()
    try:
        S3.download_fileobj(BUCKET_NAME, s3Key, f)
        return f
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None
        else:
            raise

def upload_to_s3(data, s3_key):
    S3.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=data)

def s3key_exists(s3_key):
    try:
        S3.head_object(Bucket=BUCKET_NAME, Key=s3_key)
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == "404":
            return False
        else:
            return False # ?
    return True

def is_img(s3_key):
    end4 = s3_key[-4:].lower()
    return end4 in [".jpg", "jpeg", ".tif", "tiff", ".cr2"]

def list_obj_keys(prefix):
    obj_keys = []
    continuation_token = None
    while True:
        if continuation_token:
            response = S3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=prefix, ContinuationToken=continuation_token)
        else:
            response = S3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=prefix)
        if 'Contents' in response and response['Contents']:
            for obj in response['Contents']:
                obj_key = obj['Key']
                obj_keys.append(obj_key)
        continuation_token = response.get("NextContinuationToken")
        if not continuation_token:
            break
    return obj_keys

def list_img_keys(prefix):
    obj_keys = list_obj_keys(prefix)
    obj_keys.sort()
    return filter(is_img, obj_keys)

MAX_SIZE = 1024

def s3_img_key_to_s3_pickle_key(img_s3_key):
    suffix = "_"+str(MAX_SIZE)+"_"+str(POINTS_PER_SIDE)+".pickle.gz"
    return img_s3_key.replace("/sources/", "/tmp-sam/") + suffix 
