import logging
import cv2
import numpy as np

DEBUG = False

class AnnotationInfo:
    def __init__(self, sam_annotation, original_img_width, original_img_height):
        self.sam_annotation = sam_annotation
        self.mask = sam_annotation["segmentation"]
        self.mask = (255*self.mask.astype(np.uint8)).astype('uint8')  #convert to an unsigned byte
        # SAM masks often need some cleanup
        cv2.erode(self.mask, kernel=np.ones((30, 30)), iterations=1)
        # resize the mask
        self.mask = cv2.resize(self.mask, (original_img_width, original_img_height), interpolation = cv2.INTER_NEAREST ).astype('uint8')
        self.contour, self.contour_area = self.get_largest_contour()
        self.minAreaRect = cv2.minAreaRect(self.contour)
        self.bbox = cv2.boundingRect(self.contour)

    def debug_mask(self, base_fname):
        cv2.imwrite(base_fname+"_mask.png", self.mask)
        contours, _ = cv2.findContours(self.mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        areas = [cv2.contourArea(c) for c in contours]
        max_index = np.argmax(areas)
        color_mask = np.ones((self.mask.shape[0], self.mask.shape[1], 3))
        cv2.drawContours(color_mask, contours, max_index, (0,255,0))
        cv2.rectangle(color_mask, (self.bbox[0], self.bbox[1]), (self.bbox[0]+self.bbox[2], self.bbox[1]+self.bbox[3]), (255,0,0), 3)
        box = cv2.boxPoints(self.minAreaRect)
        box = np.int0(box)
        cv2.drawContours(color_mask,[box],0,(0,0,255),2)
        cv2.imwrite(base_fname+"_contours.png", color_mask)

    def nb_edges_touched(self, px=20):
        nb_edges = 0
        # crop_box is left, top, right, bottom
        # bbox is [x,y,w,h]
        # mask.shape is [nb_rows=h,nb_cols=w,nb_channels]
        for i in range(2):
            if self.bbox[i] < px:
                nb_edges += 1
        if (abs(self.bbox[0]+self.bbox[2] - self.mask.shape[1]) < px):
                nb_edges += 1
        if (abs(self.bbox[1]+self.bbox[3] - self.mask.shape[0]) < px):
                nb_edges += 1
        return nb_edges

    def touches_top_bottom(self, px=20):
        #print("top, bottom? %d - %d / 0 - %d" % (self.bbox[1], self.bbox[1]+self.bbox[3], self.mask.shape[0]))
        return self.bbox[1] < px and abs(self.bbox[1]+self.bbox[3] - self.mask.shape[0]) < px

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
    return iou_bbox_xy1xy2wh(bbox1, bbox2)

def iou_bbox_xy1xy2wh(bbox1, bbox2):
    iArea = intersect_area_bbox_xy1xy2wh(bbox1, bbox2)
    uArea = bbox1[4]*bbox1[5] + bbox2[4]*bbox2[5] - iArea
    return iArea / float(uArea)

def intersect_area_bbox_xy1xy2wh(bbox1, bbox2):
    # determine the (x, y)-coordinates of the intersection rectangle
    ix1 = max(bbox1[0], bbox2[0])
    iy1 = max(bbox1[1], bbox2[1])
    ix2 = min(bbox1[2], bbox2[2])
    iy2 = min(bbox1[3], bbox2[3])
    return max(0, ix2 - ix1) * max(0, iy2 - iy1)

def intersect_area(ann1, ann2):
    bbox1 = xywh_xy1xy2wh(ann1.bbox)
    bbox2 = xywh_xy1xy2wh(ann2.bbox)
    return intersect_area_bbox_xy1xy2wh(bbox1, bbox2)

def is_union(union_ann, part_anns):
    # union of bboxes should be similar to bbox of the tested union
    # and their intersection should be small
    union_bbox = None
    intersection_bbox = None
    for ann in part_anns:
        ann_bbox = xywh_xy1xy2wh(ann.bbox)
        if union_bbox is None:
            union_bbox = ann_bbox.copy()
            intersection_bbox = ann_bbox.copy()
        else:
            # TODO: the union area computation is bogus...
            # but it should do for now
            union_bbox[0] = min(union_bbox[0], ann_bbox[0])
            union_bbox[1] = min(union_bbox[1], ann_bbox[1])
            union_bbox[2] = max(union_bbox[2], ann_bbox[2])
            union_bbox[3] = max(union_bbox[3], ann_bbox[3])
            intersection_bbox[0] = max(intersection_bbox[0], ann_bbox[0])
            intersection_bbox[1] = max(intersection_bbox[1], ann_bbox[1])
            intersection_bbox[2] = min(intersection_bbox[2], ann_bbox[2])
            intersection_bbox[3] = min(intersection_bbox[3], ann_bbox[3])
    parts_intersection_area = max(0, intersection_bbox[2] - intersection_bbox[0]) * max(0, intersection_bbox[3] - intersection_bbox[1])
    parts_union_area = max(0, union_bbox[2] - union_bbox[0]) * max(0, union_bbox[3] - union_bbox[1])
    # test if parts intersect
    if parts_intersection_area / float(parts_union_area) > 0.4:
        return False
    # now test if union of parts and union intersect:
    # we recompute w and h for union_bbox
    union_bbox[4] = union_bbox[2] - union_bbox[0]
    union_bbox[5] = union_bbox[3] - union_bbox[1]
    union_parts_iou = iou_bbox_xy1xy2wh(xywh_xy1xy2wh(union_ann.bbox), union_bbox)
    return union_parts_iou > 0.9

def ann_has_duplicate_in(ann, ann_list):
    for other_ann in ann_list:
        if iou(other_ann, ann) > 0.8:
            return True
    return False

def ann_included_in(ann, image_anns):
    ann_area = ann.bbox[2]*ann.bbox[3]
    for other_ann in image_anns:
        iarea = intersect_area(ann, other_ann)
        if ann_area - iarea / float(ann_area) < 0.1:
            return True
    return False

def get_image_ann_list(sam_ann_list, original_img_width, original_img_height, debug_base_fname="", expected_nb_pages=2, expected_ratio_range=[1.7, 20.0]):
    ann_list = []
    for sam_ann in sam_ann_list:
        ann_list.append(AnnotationInfo(sam_ann, original_img_width, original_img_height))
    anns_by_area = sorted(ann_list, key=(lambda x: x.contour_area), reverse=True)
    image_anns = []
    potential_split_anns = []
    ref_size = None
    for i, ann in enumerate(anns_by_area):
        if DEBUG:
            ann.debug_mask(debug_base_fname+"_%03d" % i)
        if ann.nb_edges_touched() > 2:
            #print("ann %d touches %d edges, excuding" % (i, ann.nb_edges_touched()))
            continue
        if ann.touches_top_bottom():
            #print("ann %d touches top and bottom edges, exclude" % i)
            continue
        if ann.squarishness() < 0.85:
            #print("ann %d has a squarishness of %f, excuding" % (i, ann.squarishness()))
            continue
        if ann_has_duplicate_in(ann, image_anns) or ann_has_duplicate_in(ann, potential_split_anns):
            #print("ann %d is duplicate, excuding" % i)
            continue
        if not ref_size:
            ann_ratio = ann.bbox[2] / float(ann.bbox[3])
            if not expected_ratio_range or (ann_ratio >= expected_ratio_range[0] and ann_ratio <= expected_ratio_range[1]):
                image_anns.append(ann)
                ref_size = ann.contour_area
                #print("select ann %d" % i)
            #else:
                #print("found annotation with wrong aspect ratio")
            continue
        if ann_included_in(ann, potential_split_anns):
            #print("ann %d included in potential split, excluding" % i)
            continue
        diff_factor = 0.4 if len(image_anns) < expected_nb_pages else 0.15
        #print("diff is %f / %f" % (abs(ref_size - ann.contour_area) / ann.contour_area, diff_factor))
        if abs(ref_size - ann.contour_area) / ref_size < diff_factor and not ann_included_in(ann, image_anns):
            ann_ratio = ann.bbox[2] / float(ann.bbox[3])
            if not expected_ratio_range or (ann_ratio >= expected_ratio_range[0] and ann_ratio <= expected_ratio_range[1]):
                image_anns.append(ann)
                #print("select ann %d" % i)
        elif len(image_anns) < expected_nb_pages and len(potential_split_anns) < expected_nb_pages:
            #print("add annotation %d to the potential union detection" % i)
            potential_split_anns.append(ann)
            #print("select %d as potential" % i)
        #else:
        #    break
    if len(potential_split_anns) and (len(image_anns) == 0 or is_union(image_anns[0], potential_split_anns)):
        image_anns = potential_split_anns
    # we sort by top x coordinate descending
    image_anns = sorted(image_anns, key=(lambda x: x.bbox[1]))
    if DEBUG:
        for i, image_ann in enumerate(image_anns):
            image_ann.debug_mask(debug_base_fname+"_selected%03d" % i)
    return image_anns

def test():
    with gzip.open('examples/IMG_56015_1024_sam.pickle.gz', 'rb') as f:
        anns = pickle.load(f)
        img_orig = Image.open("examples/IMG_56015.JPG")
        apply_icc(img_orig)
        image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height, "examples/IMG_56015")
        ig_img_basedir = "./"
        ig_lname = "I0123RA"
        for i, image_ann_info in enumerate(image_ann_infos):
            dst_base_fname = "%s%s%04d" % (ig_img_basedir, ig_lname, i+1)
            img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, dst_base_fname, rotate=True)
            with open(dst_base_fname+file_ext, 'wb') as f: 
                f.write(img_bytes)

if __name__ == "__main__":
    test()