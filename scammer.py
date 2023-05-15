from utils import split_s3_path, is_img, get_gzip_picked_bytes
from cal_sam_pickes import get_sam_output
import os
import boto3
import io
import botocore
from sam_annotation_utils import get_image_ann_list

class BatchRunner:
    def __init__(images_path, pipeline="sam:crop", mode=None, output_uncompressed=True, output_compressed=True, dest_path=None, points_per_side=8, sam_resize=1024, reorder=True, rotate=False, pre_rotate=0, aws_profile='image_processing'):
        self.images_path = images_path
        self.read_mode = None
        self.read_bucket = None
        self.dest_path = dest_path
        self.write_mode = None
        self.cropped_images_path = None
        self.qc_images_path = None
        self.write_bucket = None
        self.log_str = ""
        self.local_debug_dir = "debug/"
        self.max_size = sam_resize
        self.points_per_side = points_per_side
        self.expected_ratio_range = [1.8, 20.0]
        self.expected_nb_pages = 2
        # pre-rotate the images by a certain angle, most likely 90 or -90
        self.pre_rotate = 0 
        self.reorder = reorder
        self.rotate = rotate
        self.images_prefix = None
        self.analyze_read_path()
        self.analyze_write_path()
        self.SESSION = boto3.Session(profile_name=aws_profile)
        self.S3 = SESSION.client('s3')
        self.mode = mode
        self.output_compressed = output_compressed
        self.output_uncompressed = output_uncompressed

    def analyze_read_path(self):
        if self.images_path.startswith("s3://"):
            self.read_bucket, self.images_prefix = split_s3_path(self.images_path)
            self.read_mode = "S3"
            return
        self.read_mode = "local"
        if self.images_path.startswith("file://"):
            self.images_path = self.images_path[7:]

    def analyze_write_path(self):
        if self.dest_path is None:
            self.write_mode = self.read_mode
        else:
            if self.dest_path.startswith("s3://"):
                self.write_bucket, self.images_prefix = split_s3_path(self.dest_path)
                self.write_mode = "S3"
                return
            self.write_mode = "local"
            if self.dest_path.startswith("file://"):
                self.dest_path = self.dest_path[7:]

    def list_obj_keys(self, prefix):
        obj_keys = []
        continuation_token = None
        while True:
            if continuation_token:
                response = self.S3.list_objects_v2(Bucket=self.read_bucket, Prefix=prefix, ContinuationToken=continuation_token)
            else:
                response = self.S3.list_objects_v2(Bucket=self.read_bucket, Prefix=prefix)
            if 'Contents' in response and response['Contents']:
                for obj in response['Contents']:
                    obj_key = obj['Key']
                    obj_keys.append(obj_key)
            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                break
        return obj_keys

    def list_img_keys(self, prefix):
        obj_keys = self.list_obj_keys(prefix)
        obj_keys.sort()
        return filter(is_img, obj_keys)

    def gets3blob(self, s3Key):
        f = io.BytesIO()
        try:
            self.S3.download_fileobj(self.read_bucket, s3Key, f)
            return f
        except botocore.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return None
            else:
                raise

    def upload_to_s3(self, data, s3_key):
        self.S3.put_object(Bucket=self.write_bucket, Key=s3_key, Body=data)

    def img_path_to_prefixed_path(self, img_path, prefix):
        other_dir = False
        if "/images/" in img_path:
            other_dir = True
            img_path = img_path.replace("/images/", "/images_%s/" % prefix)
        if "/sources/" in img_path:
            other_dir = True
            if prefix == "cropped_compressed":
                img_path = img_path.replace("/sources/", "/images/" % prefix)
            elif prefix == "cropped_uncompressed":
                img_path = img_path.replace("/sources/", "/archive/" % prefix)
            else:
                img_path = img_path.replace("/sources/", "/sources_%s/" % prefix)
        basename = os.path.basename(img_path)
        dirname = os.path.dirname(img_path)
        if not other_dir:
            dirname = dirname+prefix+"/"
        else:
            dirname += "/"
        return dirname, basename

    def img_path_to_pickle_path(self, img_path):
        dirname, basename = img_path_to_prefixed_path("tmp_pickle")
        basename += "_sam_%d_%d.pickle.gz" % (self.sam_resize, self.points_per_side)
        return dirname, basename

    def img_path_to_qc_path_base(self, img_path):
        dirname, basename = img_path_to_prefixed_path("cropped_qc")
        basename += "_qc.jpg"
        return dirname, basename

    def img_path_to_img_path_base(self, img_path):
        return img_path_to_prefixed_path("cropped_compressed")

    def img_path_to_archive_path_base(self, img_path):
        return img_path_to_prefixed_path("cropped_uncompressed")

    def list_img_paths(self, source_path):
        img_keys = []
        if read_mode == "S3":
            img_keys = list_img_keys(self.images_path)
        else:
            img_keys = list_img_local(self.images_path)
        return img_keys

    def mkdir(self, dirname):
        if write_mode == "S3":
            return

    def process_img_path(self, img_path, next_idx):
        img_orig = None
        if self.mode == "S3":
            self.gets3blob(img_path)
        else:
            img_orig = Image.open(self.images_path + img_path)
        img_orig = apply_icc(img_orig)
        img_orig = apply_exif_rotation(img_orig)
        pickle_dirname, pickle_fname = self.img_path_to_pickle_path(img_path)
        picke_s3_path = pickle_dirname+pickle_fname
        self.mkdir(pickle_dirname)
        cropped_dirname, cropped_fname = self.img_path_to_img_path_base(img_path)
        self.mkdir(cropped_dirname)
        cropped_uncompressed_dirname, cropped_uncompressed_fname = self.img_path_to_archive_path_base(img_path)
        self.mkdir(cropped_uncompressed_dirname)
        qc_dirname, qc_fname = self.img_path_to_qc_path_base(img_path)
        self.mkdir(qc_dirname)
        sam_results = None
        if "sam" in pipeline:
            sam_results = get_sam_output(img)
            gzipped_pickled_bytes = get_gzip_picked_bytes(sam_results)
            self.upload_to_s3(gzipped_pickled_bytes, picke_s3_path)
            gzipped_pickled_bytes = None # gc
        if "crop" in pipeline and (self.output_compressed or self.output_uncompressed):
            if sam_results is None:
                blob = self.gets3blob(pickle_s3_path)
                if blob is None:
                    print("error! no "+pickle_s3_path)
                    return
                blob.seek(0)
                sam_results = gzip.decompress(blob.read())
                blob = None # gc
            image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height, debug_base_fname = os.path.basename(img_path), expected_nb_pages = self.expected_nb_pages)
            if len(image_ann_infos) != 2:
                self.log_str += "WARN: %d pages found in %s (%d expected)" % (len(image_ann_infos), img_path, self.expected_nb_pages)
            dst_base_fname = cropped_s3_prefix[cropped_s3_prefix.rfind("/")+1:]
            if not image_ann_infos:
                image_ann_infos = [ None ]
            for i, image_ann_info in enumerate(image_ann_infos):
                suffix_idx = 0 if image_ann_info is None else i+1
                prefix_idx = next_idx+i
                extracted_img = extract_img(img_orig, "%s%04d" % (dst_base_fname, next_idx+i), rotate=True)
                if self.output_uncompressed:
                    img_bytes, file_ext = encode_img_uncompressed(extracted_img)
                    cropped_s3_img_key = "%s%04d0_%s_%02d%s" % (cropped_s3_prefix, prefix_idx, orig_filename, suffix_idx, file_ext)
                    upload_to_s3(img_bytes, cropped_s3_img_key)
                    img_bytes = None # gc
                if self.output_compressed:
                    img_bytes, file_ext = encode_img(extracted_img)
                    cropped_s3_img_key = "%s%04d0_%s_%02d%s" % (cropped_s3_prefix, prefix_idx, orig_filename, suffix_idx, file_ext)
                    upload_to_s3(img_bytes, cropped_s3_img_key)
                    img_bytes = None # gc
                extracted_img = None # gc
            return next_idx + len(image_ann_infos)
