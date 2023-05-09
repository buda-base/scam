import mozjpeg_lossless_optimization
import io
import pickle
from PIL import Image, ImageCms
import cv2
import gzip
import numpy as np
import math


class AnnotationInfo:
    def __init__(self, sam_annotation, original_img_width, original_img_height):
        self.sam_annotation = sam_annotation
        mask = sam_annotation["segmentation"]
        mask = (255*mask.astype(np.uint8)).astype('uint8')  #convert to an unsigned byte
        #cv2.imwrite(dst_fname+"mask.jpg", mask)
        # SAM masks often need some cleanup
        cv2.erode(mask, kernel=np.ones((18, 18)), iterations=1)
        # resize the mask
        self.mask = cv2.resize( mask, (original_img_width, original_img_height), interpolation = cv2.INTER_NEAREST ).astype('uint8')
        self.contour, self.contour_area = self.get_largest_contour()
        self.minAreaRect = cv2.minAreaRect(self.contour)
        self.bbox = cv2.boundingRect(self.contour)

    def nb_edges_touched(self, px=20):
        sam_annotation = self.sam_annotation
        nb_edges = 0
        # crop_box is left, top, right, bottom
        # bbox is [x,y,w,h]
        for i in range(2):
            if (abs(self.bbox[i] - sam_annotation["crop_box"][i]) < px):
                nb_edges += 1
        if (abs(self.bbox[0]+self.bbox[2] - sam_annotation["crop_box"][2]) < px):
                nb_edges += 1
        if (abs(self.bbox[1]+self.bbox[3] - sam_annotation["crop_box"][3]) < px):
                nb_edges += 1
        return nb_edges

    def get_largest_contour(self):
        """ get the largest contour.
            we can expect that SAM returns masks that are just one contour but it's not
            always the case so we take the largest one
        """
        contours, _ = cv2.findContours(self.mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        areas = [cv2.contourArea(c) for c in contours]
        max_index = np.argmax(areas)
        return contours[max_index], areas[max_index]

    def squarishness(self):
        """
        compute the squarishness of a mask given the largest contour and contour area
        """
        _, (width, height), _ = self.minAreaRect
        rect_area = width * height
        return self.contour_area / rect_area

def xywh_xy1xy2wh(bbox):
    return [bbox[0],bbox[1],bbox[0]+bbox[2],bbox[1]+bbox[3],bbox[2],bbox[3]]

def iou(ann_info1, ann_info2):
    # ann bbox is (x,y,w,h)
    bbox1 = xywh_xy1xy2wh(ann_info1.bbox)
    bbox2 = xywh_xy1xy2wh(ann_info2.bbox)
    # determine the (x, y)-coordinates of the intersection rectangle
    ix1 = max(bbox1[0], bbox2[0])
    iy1 = max(bbox1[1], bbox2[1])
    ix2 = min(bbox1[2], bbox2[2])
    iy2 = min(bbox1[3], bbox2[3])
    # compute the area of intersection rectangle
    iArea = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    uArea = bbox1[4]*bbox1[5] + bbox2[4]*bbox2[5] - iArea
    return iArea / float(uArea)

def get_image_ann_list(sam_ann_list, original_img_width, original_img_height):
    ann_list = []
    for sam_ann in sam_ann_list:
        ann_list.append(AnnotationInfo(sam_ann, original_img_width, original_img_height))
    anns_by_area = sorted(ann_list, key=(lambda x: x.contour_area), reverse=True)
    image_anns = []
    ref_size = None
    for ann in anns_by_area:
        if ann.nb_edges_touched() > 2:
            continue
        if ann.squarishness() < 0.85:
            continue
        if not ref_size:
            ref_size = ann.contour_area
            image_anns.append(ann)
            continue
        if abs(ref_size - ann.contour_area) / ann.contour_area < 0.15:
            image_anns.append(ann)
        else:
            break
    # we sort by top x coordinate descending
    image_anns = sorted(image_anns, key=(lambda x: x.bbox[1]))
    # we filter by measuring iou with previous image:
    filtered_image_anns = []
    prev_image_ann = None
    for image_ann in image_anns:
        if prev_image_ann is None or iou(prev_image_ann, image_ann) < 0.85:
            filtered_image_anns.append(image_ann)
        prev_image_ann = image_ann
    return filtered_image_anns

def extract_img(img_orig, ann_info, dst_fname = "", rotate=False):
    if not rotate: # default
        return img_orig.crop((ann_info.bbox[0], ann_info.bbox[1], ann_info.bbox[0]+ann_info.bbox[2], ann_info.bbox[1]+ann_info.bbox[3]))
    # else, we usually don't go that route but just in case...
    center, (width, height), angle = ann_info.minAreaRect
    box = cv2.boxPoints(rect)
    box = np.int0(box)
    open_cv_image = np.array(img_orig)
    src_pts = box.astype("float32")
    # coordinate of the points in box points after the rectangle has been
    # straightened
    dst_pts = np.array([[0, int(height)-1],
                        [0, 0],
                        [int(width)-1, 0],
                        [int(width)-1, int(height)-1]], dtype="float32")
    # the perspective transformation matrix
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    # directly warp the rotated rectangle to get the straightened rectangle
    warped = cv2.warpPerspective(open_cv_image, M, (int(width), int(height)), cv2.INTER_LANCZOS4)
    return Image.fromarray(warped)

def encode_img(img):
    target_mode = get_best_mode(img)
    if img.mode != target_mode:
        img = img.convert(target_mode)
    if target_mode != "1":
        jpg_bytes = None
        with io.BytesIO() as output:
            img.save(output, icc_profile=img.info.get('icc_profile'), format="JPEG", quality=85, optimize=True, progressive=True, subsampling="4:2:2", comment="")
            jpg_bytes = output.getvalue()
        jpg_bytes = mozjpeg_lossless_optimization.optimize(jpg_bytes)
        return jpg_bytes, ".jpg"

def get_best_mode(img):
    return "L"

def is_grayscale(img):
    # https://stackoverflow.com/a/23661373/2560906
    # but having a threshold in the differences
    return False

def apply_icc(img):
    '''Convert PIL image to sRGB color space (if possible)'''
    icc = img.info.get('icc_profile', '')
    if icc and img.mode == "RGB":
        io_handle = io.BytesIO(icc)     # virtual file
        src_profile = ImageCms.ImageCmsProfile(io_handle)
        dst_profile = ImageCms.createProfile('sRGB')
        ImageCms.profileToProfile(img, src_profile, dst_profile, inPlace=True)

def extract_encode_img(img_orig, sam_annotation, dst_fname, rotate=False):
    cropped_img = extract_img(img_orig, sam_annotation, dst_fname, rotate)
    return encode_img(cropped_img)

def test():
    with gzip.open('examples/IMG_56015_1024_sam.pickle.gz', 'rb') as f:
        anns = pickle.load(f)
        img_orig = Image.open("examples/IMG_56015.JPG")
        apply_icc(img_orig)
        image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height)
        ig_img_basedir = "./"
        ig_lname = "I0123"
        for i, image_ann_info in enumerate(image_ann_infos):
            dst_base_fname = "%s%s%04d" % (ig_img_basedir, ig_lname, i+1)
            img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, dst_base_fname)
            with open(dst_base_fname+file_ext, 'wb') as f: 
                f.write(img_bytes)

test()