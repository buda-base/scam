from utils import split_s3_path, list_img_keys, is_img

class BatchRunner:
    def __init__(images_path, pipeline="crop", dest_path=None, points_per_side=8, sam_resize=1024):
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
        self.expected_rotation = 0 
        self.images_prefix = None
        self.analyze_read_path()
        self.analyze_write_path()

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

    def img_path_to_pickle_path(self, img_path):
        return "", ""

    def img_path_to_qc_path(self, img_path):
        return "", ""

    def img_path_to_img_path(self, img_path):
        return "", ""

    def list_img_paths(self, source_path):
        img_keys = []
        if read_mode == "S3":
            img_keys = list_img_keys(self.images_path)
        else:
            img_keys = list_img_local(self.images_path)
        return img_keys

    def process_img_path(self, img_path):
        img_orig = None
        if self.mode == "S3":
            
        else:
            img_orig = Image.open(self.images_path + img_path)
        img_orig = apply_icc(img_orig)
        img_orig = apply_exif_rotation(img_orig)
        pickle_path = self.img_path_to_pickle_path(img_)
