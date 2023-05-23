from pathlib import Path

from utils import split_s3_path, is_img, get_gzip_picked_bytes, list_img_keys, list_img_local
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
from raw_pillow_opener import register_raw_opener


class BatchRunner:
    def __init__(
            self,
            images_path,
            pipeline="sam:crop",
            img_mode=None,
            expected_nb_pages=2,
            expected_ratio_range=[1.8, 20.0],
            min_area_ratio=0.1,
            output_uncompressed=True,
            output_compressed=False,
            dest_path=None,
            points_per_side=8,
            points_per_side_2=32,
            sam_resize=1024,
            rotate=True,
            expand_mask_pct=0,
            skip_if_exists=True,
            pre_rotate=0,
            aws_profile=None,
            apply_exif_rotation=False,
            dryrun=False):
        self.images_path = images_path
        self.min_area_ratio = min_area_ratio
        self.pipeline = pipeline
        self.dryrun = dryrun
        self.read_mode = None
        self.read_bucket = None
        self.dest_path = dest_path
        self.write_mode = None
        self.skip_if_exists = skip_if_exists
        self.cropped_images_path = None
        self.qc_images_path = None
        self.write_bucket = None
        self.log_str = ""
        self.local_debug_dir = "debug/"
        self.sam_resize = sam_resize
        self.points_per_side = points_per_side
        self.points_per_side_2 = points_per_side_2
        self.expected_ratio_range = expected_ratio_range
        self.expected_nb_pages = expected_nb_pages
        self.apply_exif_rotation = apply_exif_rotation
        # pre-rotate the images by a certain angle, most likely 90 or -90
        self.pre_rotate = pre_rotate
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
        """
        Original fails when input path is a file.
        Fixed
        """
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
                response = self.S3.list_objects_v2(Bucket=self.read_bucket, Prefix=prefix,
                                                   ContinuationToken=continuation_token)
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

    def s3key_exists(self, s3Key):
        try:
            self.S3.head_object(Bucket=self.read_bucket, Key=s3Key)
            return True
        except botocore.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            else:
                raise

    def upload_to_s3(self, data, s3_key):
        if not self.dryrun:
            self.S3.put_object(Bucket=self.write_bucket, Key=s3_key, Body=data)

    def img_path_to_prefixed_path(self, img_path, prefix):
        other_dir = False
        if img_path.startswith(self.images_path) and self.images_path != self.dest_path:
            img_path = self.dest_path + img_path[len(self.images_path):]
            if prefix == "cropped_uncompressed":
                other_dir = True
        if "/images/" in img_path:
            other_dir = True
            if prefix == "cropped_uncompressed":
                img_path = img_path.replace("/images/", "/archive/")
            else:
                img_path = img_path.replace("/images/", "/images%s/" % prefix)
        if "/sources/" in img_path:
            other_dir = True
            if prefix == "cropped_compressed":
                img_path = img_path.replace("/sources/", "/images/")
            elif prefix == "cropped_uncompressed":
                img_path = img_path.replace("/sources/", "/archive/")
            else:
                img_path = img_path.replace("/sources/", "/sources%s/" % prefix)
        basename = os.path.basename(img_path)
        dirname = os.path.dirname(img_path)
        if not other_dir:
            dirname = dirname + prefix + "/"
        else:
            dirname += "/"
        return dirname, basename

    def img_path_to_pickle_path(self, img_path, points_per_side):
        dirname, basename = self.img_path_to_prefixed_path(img_path, "_tmp_pickle")
        angle_suffix = ""
        if self.pre_rotate != 0:
            angle_suffix = "_" + str(self.pre_rotate)
        basename += "_sam_%d_%d%s.pickle.gz" % (self.sam_resize, points_per_side, angle_suffix)
        return dirname, basename

    def img_path_to_qc_path_base(self, img_path):
        dirname, basename = self.img_path_to_prefixed_path(img_path, "_cropped_qc")
        basename += "_qc.jpg"
        return dirname, basename

    def img_path_to_img_path_base(self, img_path):
        return self.img_path_to_prefixed_path(img_path, "_cropped_compressed")

    def img_path_to_archive_path_base(self, img_path):
        dirname, basename = self.img_path_to_prefixed_path(img_path, "_cropped_uncompressed")
        basename = os.path.splitext(basename)[0]  # removing extension
        return dirname, basename

    def list_img_paths(self, source_path):
        list_func = lambda m: list_img_keys if m == "S3" else list_img_local
        img_keys = []
        for img_full_key in sorted(list_func(self.read_mode)(self.images_path)):
            # This is fragile,depending on how S3 or files interpret the trailing slash
            # img_keys.append(img_full_key[len(self.images_path):])
            img_keys.append(Path(img_full_key).name)

        #         img_keys.append(img_full_key[len(self.images_path):])
        # if self.read_mode == "S3":
        #     for img_full_key in sorted(list_img_keys(self.images_path)):
        #         img_keys.append(img_full_key[len(self.images_path):])
        # else:
        #     img_keys = list_img_local(self.images_path)
        return img_keys

    def save_file(self, dirname, fname, data):
        self.log_str += "   save %s\n" % (dirname + fname)
        if self.write_mode == "S3":
            self.upload_to_s3(data, dirname + fname)
        if self.write_mode == "local":
            with open(Path(dirname, fname), "wb") as outf:
                outf.write(data)

    def file_exists(self, dirname, fname):
        """
        Original didn't return a value to test
        """
        if self.write_mode == "S3":
            return self.s3key_exists(dirname + fname)
        if self.write_mode == "local":
            return os.path.exists(Path(dirname, fname))

    def mkdir(self, dirname):
        if self.write_mode == "S3":
            return
        if self.write_mode == "local":
            os.makedirs(Path(dirname), exist_ok=True)

    def get_save_sam(self, img_path, img_orig, points_per_side):
        pickle_dirname, pickle_fname = self.img_path_to_pickle_path(self.images_path + img_path, points_per_side)
        if self.skip_if_exists and self.file_exists(pickle_dirname, pickle_fname):
            blob = self.gets3blob(pickle_dirname + pickle_fname)
            blob.seek(0)
            return pickle.loads(gzip.decompress(blob.read()))
        self.log_str += "   generate SAM results for %s , pps: %d\n" % (img_path, points_per_side)
        sam_results = get_sam_output(img_orig, max_size=self.sam_resize, points_per_side=points_per_side)
        gzipped_pickled_bytes = get_gzip_picked_bytes(sam_results)
        self.mkdir(pickle_dirname)
        self.save_file(pickle_dirname, pickle_fname, gzipped_pickled_bytes)
        return sam_results

    def crop_from_sam_results(self, img_path, img_dir_info, img_orig, sam_results, save_if_fail, points_per_side):
        """
        analyzes the results from SAM and saves the results, returning True

        If save_if_fail is false and the number of detected pages is not
        what was expected, doesn't save the results and returns False
        """
        image_ann_infos = get_image_ann_list(sam_results, img_orig.width, img_orig.height,
                                             debug_base_fname=os.path.basename(img_path),
                                             expected_nb_pages=self.expected_nb_pages,
                                             min_area_ratio=self.min_area_ratio,
                                             expected_ratio_range=self.expected_ratio_range)
        if len(image_ann_infos) != self.expected_nb_pages:
            if not save_if_fail:
                return False
            self.log_str += "   WARN: %d pages found in %s [%s] (%d expected, pps: %d)\n" % (
            len(image_ann_infos), self.images_path + img_path, img_dir_info, self.expected_nb_pages, points_per_side)
        if not image_ann_infos:
            image_ann_infos = [None]
        for i, image_ann_info in enumerate(image_ann_infos):
            suffix_idx = 0 if image_ann_info is None else i + 1
            cropped_fname_letter = chr(97 + i)
            extracted_img = extract_img(img_orig, image_ann_info, img_path, rotate=self.rotate)
            if self.output_uncompressed:
                cropped_uncompressed_dirname, cropped_uncompressed_fname_base = self.img_path_to_archive_path_base(
                    self.images_path + img_path)
                self.mkdir(cropped_uncompressed_dirname)
                img_bytes, file_ext = encode_img_uncompressed(extracted_img)
                cropped_uncompressed_fname = "%s%s%s" % (
                cropped_uncompressed_fname_base, cropped_fname_letter, file_ext)
                self.save_file(cropped_uncompressed_dirname, cropped_uncompressed_fname, img_bytes)
                img_bytes = None  # gc
            if self.output_compressed:
                cropped_dirname, cropped_fname = self.img_path_to_img_path_base(self.images_path + img_path)
                self.mkdir(cropped_dirname)
                img_bytes, file_ext = encode_img(extracted_img)

                # WARNING: cropped_uncompressed_fname_base might be referenced before assignment.
                # fix up
                cropped_uncompressed_fname = "%s%s%s" % (
                cropped_uncompressed_fname_base, cropped_fname_letter, file_ext)
                self.save_file(cropped_uncompressed_dirname, cropped_uncompressed_fname, img_bytes)
                img_bytes = None
            # TODO: output QC
            qc_dirname, qc_fname = self.img_path_to_qc_path_base(img_path)
            self.mkdir(qc_dirname)
        return True

    def get_sam_results(self, img_path, points_per_side):
        pickle_dirname, pickle_fname = self.img_path_to_pickle_path(self.images_path + img_path, points_per_side)
        self.log_str += "   getting SAM results from %s\n" % (pickle_dirname + pickle_fname)
        blob = self.gets3blob(pickle_dirname + pickle_fname)
        if blob is None:
            self.log_str += "  error! no %s" % (pickle_dirname + pickle_fname)
            return
        blob.seek(0)
        return pickle.loads(gzip.decompress(blob.read()))

    def process_img_path(self, img_path, img_dir_info=""):
        self.log_str += " looking at %s\n" % img_path
        img_orig = None
        if img_path.endswith("cr2"):
            register_raw_opener()
        if self.read_mode == "S3":
            img_orig = Image.open(self.gets3blob(self.images_path + img_path))
        else:
            img_orig = Image.open(str(Path(self.images_path, img_path)))
        img_orig = apply_icc(img_orig)  # maybe icc shouldn't be applied to archive images?
        if self.apply_exif_rotation:
            img_orig = apply_exif_rotation(img_orig)
        if self.pre_rotate:
            img_orig = img_orig.rotate(self.pre_rotate, expand=True)
        sam_results = None
        if "sam" in self.pipeline:
            sam_results = self.get_save_sam(img_path, img_orig, self.points_per_side)
            if "crop" in self.pipeline:
                # we first try with a lower points per side:
                success = self.crop_from_sam_results(img_path, img_dir_info, img_orig, sam_results, False, self.points_per_side)
                if success:
                    return
                self.log_str += "   INFO: failing with pps = %d, retrying with pps = %d" % (
                self.points_per_side, self.points_per_side_2)
                # if it didn't work, we try with a higher one:
                sam_results = self.get_save_sam(img_path, img_orig, self.points_per_side_2)
                success = self.crop_from_sam_results(img_path, img_dir_info, img_orig, sam_results, True,
                                                     self.points_per_side_2)
        else:
            if "crop" not in self.pipeline or (not self.output_compressed and not self.output_uncompressed):
                print("nothing to do!")
                return
            sam_results = self.get_sam_results(img_path, self.points_per_side)
            self.crop_from_sam_results(img_path, img_dir_info, img_orig, sam_results, True, self.points_per_side)

    def process_dir(self):
        self.log_str += "process dir %s" % self.images_path
        img_paths = self.list_img_paths(self.images_path)
        for i, img_path in enumerate(tqdm.tqdm(img_paths)):
            self.process_img_path(img_path, "%d/%d" % (i + 1, len(img_paths)))


def main():
    if len(sys.argv) <= 1:
        print("nothing to do, please pass the path to a csv file")

    with open(sys.argv[1], newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            br = BatchRunner(row[0], expected_ratio_range = [0.5, 30.0], expected_nb_pages = 1, pipeline=row[1], dryrun=False, rotate=False, aws_profile='image_processing')
            br.process_dir()
            print(br.log_str)

def process_individual_images(csv_fname):
    with open(csv_fname, newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            imgdir = row[0][:row[0].rfind("/")+1]
            imgfname = row[0][row[0].rfind("/")+1:]
            br = BatchRunner(imgdir, pipeline="sam:crop", points_per_side=8, points_per_side_2=32, dryrun=False, rotate=True, aws_profile='image_processing')
            br.process_img_path(imgfname)
            print(br.log_str)


def test():
    br = BatchRunner("s3://image-processing.bdrc.io/ER/W1ER123/sources/W1ER123-I1ER797/", pipeline="crop", dryrun=False, rotate=True, aws_profile='image_processing')
    #br.process_img_path("E 2256-00  001.jpg") # to test a particular image
    br.process_dir()
    print(br.log_str)

def matho():
    br = BatchRunner("s3://image-processing.bdrc.io/Matho/", dest_path="s3://image-processing.bdrc.io/Matho-cropped/", expected_ratio_range = [0.5, 30.0], expected_nb_pages = 1, pipeline="sam", dryrun=False, rotate=False, aws_profile='image_processing')
    br.process_dir()
    print(br.log_str)

if __name__ == "__main__":
    main()
    # matho()
    # test()
    # process_individual_images("failed.csv")
