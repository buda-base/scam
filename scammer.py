from utils import split_s3_path, is_img, get_gzip_picked_bytes, list_img_keys
from cal_sam_pickles import get_sam_output
from img_utils import apply_exif_rotation, apply_icc, extract_img, encode_img_uncompressed, encode_img
import os
import boto3
import io
import gzip
import pickle
import botocore
import tqdm
from sam_annotation_utils import get_image_ann_list
from PIL import Image
import cv2
import sys
import csv

class BatchRunner:
    def __init__(self, images_path, pipeline="sam:crop", img_mode=None, expected_ratio_range = [1.8, 20.0], output_uncompressed=True, output_compressed=False, dest_path=None, points_per_side=8, sam_resize=1024, rotate=True, expand_mask_pct=0, pre_rotate=0, aws_profile=None, dryrun=False):
        self.images_path = images_path
        self.pipeline = pipeline
        self.dryrun = dryrun
        self.read_mode = None
        self.read_bucket = None
        self.dest_path = dest_path
        self.write_mode = None
        self.cropped_images_path = None
        self.qc_images_path = None
        self.write_bucket = None
        self.log_str = ""
        self.local_debug_dir = "debug/"
        self.sam_resize = sam_resize
        self.points_per_side = points_per_side
        self.expected_ratio_range = expected_ratio_range
        self.expected_nb_pages = 2
        # pre-rotate the images by a certain angle, most likely 90 or -90
        self.pre_rotate = 0 
        self.rotate = rotate
        self.images_prefix = None
        self.analyze_read_path()
        self.analyze_write_path()
        if aws_profile is not None:
            SESSION = boto3.Session(profile_name=aws_profile)
            self.S3 = SESSION.client('s3')
        self.img_mode = img_mode
        self.output_compressed = output_compressed
        self.output_uncompressed = output_uncompressed
        self.expand_mask_pct = expand_mask_pct
        self.log_str += "OpenCV version %s\n" % cv2.__version__

    def analyze_read_path(self):
        if self.images_path.startswith("s3://"):
            self.read_bucket, self.images_path = split_s3_path(self.images_path)
            self.read_mode = "S3"
            return
        self.read_mode = "local"
        if self.images_path.startswith("file://"):
            self.images_path = self.images_path[7:]

    def analyze_write_path(self):
        if self.dest_path is None:
            self.write_mode = self.read_mode
            self.write_bucket = self.read_bucket
            self.dest_path = self.images_path
        else:
            if self.dest_path.startswith("s3://"):
                self.write_bucket, self.dest_path = split_s3_path(self.dest_path)
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
        if not self.dryrun:
            self.S3.put_object(Bucket=self.write_bucket, Key=s3_key, Body=data)

    def img_path_to_prefixed_path(self, img_path, prefix):
        other_dir = False
        if "/images/" in img_path:
            other_dir = True
            if prefix == "cropped_uncompressed":
                img_path = img_path.replace("/images/", "/archive/")
            else:
                img_path = img_path.replace("/images/", "/images_%s/" % prefix)
        if "/sources/" in img_path:
            other_dir = True
            if prefix == "cropped_compressed":
                img_path = img_path.replace("/sources/", "/images/")
            elif prefix == "cropped_uncompressed":
                img_path = img_path.replace("/sources/", "/archive/")
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
        dirname, basename = self.img_path_to_prefixed_path(img_path, "tmp_pickle")
        basename += "_sam_%d_%d.pickle.gz" % (self.sam_resize, self.points_per_side)
        return dirname, basename

    def img_path_to_qc_path_base(self, img_path):
        dirname, basename = self.img_path_to_prefixed_path(img_path, "cropped_qc")
        basename += "_qc.jpg"
        return dirname, basename

    def img_path_to_img_path_base(self, img_path):
        return self.img_path_to_prefixed_path(img_path, "cropped_compressed")

    def img_path_to_archive_path_base(self, img_path):
        dirname, basename = self.img_path_to_prefixed_path(img_path, "cropped_uncompressed")
        basename = os.path.splitext(basename)[0] # removing extension
        return dirname, basename

    def list_img_paths(self, source_path):
        img_keys = []
        if self.read_mode == "S3":
            img_keys = []
            for img_full_key in sorted(list_img_keys(self.images_path)):
                img_keys.append(img_full_key[len(self.images_path):])
        else:
            img_keys = list_img_local(self.images_path)
        return img_keys

    def save_file(self, dirname, fname, data):
        self.log_str += "   save %s\n" % (dirname+fname)
        if self.write_mode == "S3":
            self.upload_to_s3(data, dirname+fname)

    def mkdir(self, dirname):
        if self.write_mode == "S3":
            return

    def process_img_path(self, img_path):
        self.log_str += "looking at %s\n" % img_path
        pickle_dirname, pickle_fname = self.img_path_to_pickle_path(self.images_path + img_path)
        self.mkdir(pickle_dirname)
        img_orig = None
        if self.read_mode == "S3":
            img_orig = Image.open(self.gets3blob(self.images_path + img_path))
        else:
            img_orig = Image.open(self.images_path + img_path)
        img_orig = apply_icc(img_orig) # maybe icc shouldn't be applied to archive images?s
        img_orig = apply_exif_rotation(img_orig)
        sam_results = None
        if "sam" in self.pipeline:
            self.log_str += "   generate SAM results\n"
            sam_results = get_sam_output(img_orig)
            gzipped_pickled_bytes = get_gzip_picked_bytes(sam_results)
            self.save_file(pickle_dirname, pickle_fname, gzipped_pickled_bytes)
            gzipped_pickled_bytes = None # gc
        if "crop" in self.pipeline and (self.output_compressed or self.output_uncompressed):
            if sam_results is None:
                blob = self.gets3blob(pickle_dirname+pickle_fname)
                if blob is None:
                    self.log_str += "  error! no %s" % (pickle_dirname+pickle_fname)
                    return
                blob.seek(0)
                sam_results = pickle.loads(gzip.decompress(blob.read()))
                self.log_str += "   get SAM results from %s\n" % (self.images_path + img_path)
                blob = None # gc
            image_ann_infos = get_image_ann_list(sam_results, img_orig.width, img_orig.height, debug_base_fname = os.path.basename(img_path), expected_nb_pages = self.expected_nb_pages)
            if len(image_ann_infos) != 2:
                self.log_str += "   WARN: %d pages found in %s (%d expected)\n" % (len(image_ann_infos), img_path, self.expected_nb_pages)
            if not image_ann_infos:
                image_ann_infos = [ None ]
            for i, image_ann_info in enumerate(image_ann_infos):
                suffix_idx = 0 if image_ann_info is None else i+1
                cropped_fname_letter = chr(97+i)
                extracted_img = extract_img(img_orig, image_ann_info, img_path, rotate=self.rotate)
                if self.output_uncompressed:
                    cropped_uncompressed_dirname, cropped_uncompressed_fname_base = self.img_path_to_archive_path_base(self.images_path + img_path)
                    self.mkdir(cropped_uncompressed_dirname)
                    img_bytes, file_ext = encode_img_uncompressed(extracted_img)
                    cropped_uncompressed_fname = "%s%s%s" % (cropped_uncompressed_fname_base, cropped_fname_letter, file_ext)
                    self.save_file(cropped_uncompressed_dirname, cropped_uncompressed_fname, img_bytes)
                    img_bytes = None # gc
                if self.output_compressed:
                    cropped_dirname, cropped_fname = self.img_path_to_img_path_base(self.images_path + img_path)
                    self.mkdir(cropped_dirname)
                    img_bytes, file_ext = encode_img(extracted_img)
                    cropped_uncompressed_fname = "%s%s%s" % (cropped_uncompressed_fname_base, cropped_fname_letter, file_ext)
                    self.save_file(cropped_uncompressed_dirname, cropped_uncompressed_fname, img_bytes)
                    img_bytes = None
                # TODO: output QC
                qc_dirname, qc_fname = self.img_path_to_qc_path_base(img_path)
                self.mkdir(qc_dirname)

    def process_dir(self):
        for img_path in tqdm.tqdm(self.list_img_paths(self.images_path)):
            self.process_img_path(img_path)

def main():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            br = BatchRunner(row[0], pipeline=row[1], dryrun=False, rotate=True, aws_profile='image_processing')
            br.process_dir()
            print(br.log_str)

def test():
    br = BatchRunner("s3://image-processing.bdrc.io/ER/W1ER120/sources/W1ER120-I1ER790/", pipeline="crop", dryrun=False, rotate=True, aws_profile='image_processing')
    #br.process_img_path("IMG_56013.JPG") # to test a particular image
    br.process_dir()
    print(br.log_str)

if __name__ == "__main__":
    main()