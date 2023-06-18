import logging
import cv2
import numpy as np
import statistics
import copy
import math
import json

DEBUG = True

class AnnotationInfo:
    def __init__(self, sam_annotation, original_img_width, original_img_height, rotation=0):
        self.sam_annotation = sam_annotation
        self.mask = sam_annotation["segmentation"]
        self.mask = (255*self.mask.astype(np.uint8)).astype('uint8')  #convert to an unsigned byte
        if rotation != 0:
            # rotation is in degrees counter clockwise
            cv2_rot = cv2.ROTATE_90_COUNTERCLOCKWISE
            if rotation == 270 or rotation == -90:
                cv2_rot = cv2.ROTATE_90_CLOCKWISE
            if rotation == 180:
                cv2_rot = cv2.ROTATE_180
            self.mask = cv2.rotate(self.mask, cv2_rot)
        # SAM masks often need some cleanup
        cv2.erode(self.mask, kernel=np.ones((30, 30)), iterations=1)
        # resize the mask
        self.mask = cv2.resize(self.mask, (original_img_width, original_img_height), interpolation = cv2.INTER_NEAREST ).astype('uint8')
        self.contour, self.contour_area = self.get_largest_contour()
        self.minAreaRect = cv2.minAreaRect(self.contour)
        self.bbox = cv2.boundingRect(self.contour)
        self.warns = []

    def to_scam_json_obj(self):
        (cx, cy), (w, h), angle = self.minAreaRect
        if angle > 45:
            angle = angle-90
            w, h = h, w
        return {
            "minAreaRect": [cx, cy, w, h, angle],
            "warnings": self.warns
        }

    def toJSON(self):
        return json.dumps(self.to_scam_json_obj)

    def debug_mask(self, base_fname):
        print("write %s" % "debug/"+base_fname+"_mask.png")
        cv2.imwrite("debug/"+base_fname+"_mask.png", self.mask)
        contours, _ = cv2.findContours(self.mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        areas = [cv2.contourArea(c) for c in contours]
        max_index = np.argmax(areas)
        color_mask = np.ones((self.mask.shape[0], self.mask.shape[1], 3))
        cv2.drawContours(color_mask, contours, max_index, (0,255,0))
        cv2.rectangle(color_mask, (self.bbox[0], self.bbox[1]), (self.bbox[0]+self.bbox[2], self.bbox[1]+self.bbox[3]), (255,0,0), 3)
        box = cv2.boxPoints(self.minAreaRect)
        box = np.int0(box)
        cv2.drawContours(color_mask,[box],0,(0,0,255),2)
        cv2.imwrite("debug/"+base_fname+"_contours.png", color_mask)

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

    def touches_left_right(self, px=20):
        #print("top, bottom? %d - %d / 0 - %d" % (self.bbox[1], self.bbox[1]+self.bbox[3], self.mask.shape[0]))
        return self.bbox[0] < px and abs(self.bbox[0]+self.bbox[2] - self.mask.shape[1]) < px

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

def find_anomalies(data):
    """
    Function to Detection Outlier on one-dimentional datasets
    from https://gist.github.com/wmlba/89bc2f4556b8ee397ca7a5017b497657#file-outlier_std-py
    """
    if len(data) < 5:
        return []

    #define a list to accumlate anomalies
    anomalies = []
    
    # Set upper and lower limit to 3 standard deviation
    data_std = statistics.stdev(data)
    data_mean = statistics.mean(data)
    anomaly_cut_off = data_std * 3
    
    lower_limit  = data_mean - anomaly_cut_off 
    upper_limit = data_mean + anomaly_cut_off
    # Generate outliers
    for p in data:
        if p > upper_limit or p < lower_limit:
            anomalies.append(p)
    return anomalies

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
        if (ann_area - iarea) / float(ann_area) < 0.1:
            return True
    return False

def get_direction(image_anns):
    """
    returns "x" or "y" depending on the axis of the annotations
    """
    # we need to order the annotations in the page order, sometimes left to right, sometimes top to bottom
    # we get the annotation centers:
    centers_x = []
    centers_y = []
    for img_ann in image_anns:
        centers_x.append(img_ann.bbox[0]+(img_ann.bbox[2]/2))
        centers_y.append(img_ann.bbox[1]+(img_ann.bbox[3]/2))
    centers_x.sort()
    centers_y.sort()
    var_x = centers_x[-1] - centers_x[0]
    var_y = centers_y[-1] - centers_y[0]
    #print("var_x = %d, var_y = %d" % (var_x, var_y))
    return "x" if var_x > var_y else "y"

def order_image_annotation(image_anns):
    if len(image_anns) < 2:
        return image_anns
    d = get_direction(image_anns)
    if d == "x":
        return sorted(image_anns, key=(lambda x: x.bbox[0]))
    else:
        return sorted(image_anns, key=(lambda x: x.bbox[1]))

#def has_parts_in(image_ann, potential_split_anns):
#    for 

def handle_unions(image_anns, potential_split_anns):
    if len(potential_split_anns) == 0:
        return image_anns
    if len(image_anns) == 0:
        return potential_split_anns
    d = get_direction(image_anns)
    #image_anns = order_image_annotation(image_anns)
    #potential_split_anns = order_image_annotation(potential_split_anns)
    if is_union(image_anns[0], potential_split_anns):
        return potential_split_anns
    # TODO: implement a more thorought approach, but the number of tests
    # get too big too quickly with a naive approach
    return image_anns

def print_debug(s):
    if DEBUG:
        print(s)

def get_image_ann_list(sam_ann_list, original_img_width, original_img_height, debug_base_fname="", expected_nb_pages=2, expected_ratio_range=[1.7, 20.0], min_area_ratio=0.01, find_borders=False):
    ann_list = []
    for sam_ann in sam_ann_list:
        ann_list.append(AnnotationInfo(sam_ann, original_img_width, original_img_height))
    anns_by_area = sorted(ann_list, key=(lambda x: x.contour_area), reverse=True)
    image_anns = []
    potential_split_anns = []
    ref_size = None
    total_area = float(original_img_height * original_img_width)
    for i, ann in enumerate(anns_by_area):
        ann_ratio = ann.bbox[2] / float(ann.bbox[3])
        print_debug("ann %d, bbox %s, aspect ratio %f" % (i, str(ann.bbox), ann_ratio))
        if DEBUG:
            ann.debug_mask(debug_base_fname+"_%03d" % i)
        if ann.contour_area / total_area < min_area_ratio:
            print_debug("reject annotation with ratio = %f < %f" % (ann.contour_area / total_area, min_area_ratio))
            break
        #if ann.nb_edges_touched() > 2:
        #    print_debug("ann %d touches %d edges, excuding" % (i, ann.nb_edges_touched()))
        #    continue
        if ann.touches_top_bottom():
            print_debug("ann %d touches top and bottom edges, exclude" % i)
            continue
        #if ann.touches_left_right():
        #    print_debug("ann %d touches top and bottom edges, exclude" % i)
        #    continue
        if ann.squarishness() < 0.85:
            print_debug("ann %d has a squarishness of %f, excuding" % (i, ann.squarishness()))
            continue
        if ann_has_duplicate_in(ann, image_anns) or ann_has_duplicate_in(ann, potential_split_anns):
            print_debug("ann %d is duplicate, excuding" % i)
            continue
        if not ref_size:
            if not expected_ratio_range or (ann_ratio >= expected_ratio_range[0] and ann_ratio <= expected_ratio_range[1]):
                image_anns.append(ann)
                ref_size = ann.contour_area
                print_debug("select ann %d with area ratio %f, aspect ratio %f" % (i, ann.contour_area / total_area, ann_ratio))
            else:
                print_debug("reject annotation %d with wrong aspect ratio %f not in [%f, %f]" % (i, ann_ratio, expected_ratio_range[0], expected_ratio_range[1]))
            continue
        if ann_included_in(ann, potential_split_anns):
            print_debug("ann %d included in potential split, excluding" % i)
            continue
        diff_factor = 0.4 if len(image_anns) < expected_nb_pages else 0.15
        print_debug("diff is %f / %f" % (abs(ref_size - ann.contour_area) / ann.contour_area, diff_factor))
        if abs(ref_size - ann.contour_area) / ref_size < diff_factor and not ann_included_in(ann, image_anns):
            if not expected_ratio_range or (ann_ratio >= expected_ratio_range[0] and ann_ratio <= expected_ratio_range[1]):
                image_anns.append(ann)
                print_debug("select ann %d, aspect ratio %f" % (i, ann_ratio))
        elif len(image_anns) < expected_nb_pages and len(potential_split_anns) < expected_nb_pages:
            print_debug("add annotation %d to the potential union detection, aspect ratio %f" % (i, ann_ratio))
            potential_split_anns.append(ann)
        #else:
        #    break
    image_anns = handle_unions(image_anns, potential_split_anns)
    # we sort according to the split direction:
    image_anns = order_image_annotation(image_anns)
    if DEBUG:
        for i, image_ann in enumerate(image_anns):
            image_ann.debug_mask(debug_base_fname+"_selected%03d" % i)
    if find_borders:
        image_anns = find_cut_borders(image_anns, anns_by_area)
    return image_anns

def add_scam_results(file_info, sam_ann_list, scam_options):
    ann_list = []
    for sam_ann in sam_ann_list:
        ann_list.append(AnnotationInfo(sam_ann, file_info["width"], file_info["height"], file_info["rotation"]))
    anns_by_area = sorted(ann_list, key=(lambda x: x.contour_area), reverse=True)
    image_anns = []
    potential_split_anns = []
    ref_size = None
    total_area = float(file_info["height"] * file_info["width"])
    for i, ann in enumerate(anns_by_area):
        ann_ratio = ann.bbox[2] / float(ann.bbox[3])
        print_debug("ann %d, bbox %s, aspect ratio %f" % (i, str(ann.bbox), ann_ratio))
        if DEBUG:
            ann.debug_mask(debug_base_fname+"_%03d" % i)
        if ann.contour_area / total_area < scam_options["area_ratio_min"]:
            print_debug("reject annotation with ratio = %f < %f" % (ann.contour_area / total_area, scam_options["area_ratio_min"]))
            break
        if scam_options["direction"] == "vertical" and ann.touches_top_bottom():
            print_debug("ann %d touches top and bottom edges, exclude" % i)
            continue
        if scam_options["direction"] == "horizontal" and ann.touches_left_right():
            print_debug("ann %d touches top and bottom edges, exclude" % i)
            continue
        if ann.squarishness() < scam_options["squarishness_min_warn"]:
            print_debug("ann %d has a squarishness of %f, excuding" % (i, ann.squarishness()))
            continue
        if ann.squarishness() < scam_options["squarishness_min"]:
            ann.warns.append("squarishness")
        if ann_has_duplicate_in(ann, image_anns) or ann_has_duplicate_in(ann, potential_split_anns):
            print_debug("ann %d is duplicate, excuding" % i)
            continue
        if not ref_size:
            if not scam_options["wh_ratio_range"] or (ann_ratio >= scam_options["wh_ratio_range"][0] and ann_ratio <= scam_options["wh_ratio_range"][1]):
                image_anns.append(ann)
                ref_size = ann.contour_area
                print_debug("select ann %d with area ratio %f, aspect ratio %f" % (i, ann.contour_area / total_area, ann_ratio))
            else:
                print_debug("reject annotation %d with wrong aspect ratio %f not in [%f, %f]" % (i, ann_ratio, scam_options["wh_ratio_range"][0], scam_options["wh_ratio_range"][1]))
            continue
        if ann_included_in(ann, potential_split_anns):
            print_debug("ann %d included in potential split, excluding" % i)
            continue
        diff_factor = 0.4 if len(image_anns) < scam_options["nb_pages_expected"] else 0.15
        print_debug("diff is %f / %f" % (abs(ref_size - ann.contour_area) / ann.contour_area, diff_factor))
        if abs(ref_size - ann.contour_area) / ref_size < diff_factor and not ann_included_in(ann, image_anns):
            if not scam_options["wh_ratio_range"] or (ann_ratio >= scam_options["wh_ratio_range"][0] and ann_ratio <= scam_options["wh_ratio_range"][1]):
                image_anns.append(ann)
                print_debug("select ann %d, aspect ratio %f" % (i, ann_ratio))
        elif len(image_anns) < scam_options["nb_pages_expected"] and len(potential_split_anns) < scam_options["nb_pages_expected"]:
            print_debug("add annotation %d to the potential union detection, aspect ratio %f" % (i, ann_ratio))
            potential_split_anns.append(ann)
        #else:
        #    break
    image_anns = handle_unions(image_anns, potential_split_anns)
    # we sort according to the split direction:
    image_anns = order_image_annotation(image_anns)
    if DEBUG:
        for i, image_ann in enumerate(image_anns):
            image_ann.debug_mask(debug_base_fname+"_selected%03d" % i)
    file_info["pages"] = []
    for image_ann in image_anns:
        ann_obj = image_ann.to_scam_json_obj
        file_info["pages"].append(ann_obj)

def rotate(origin, point, angle):
    """
    Rotate a point counterclockwise by a given angle around a given origin.

    The angle should be given in radians.

    https://stackoverflow.com/a/34374437/2560906
    """
    ox, oy = origin
    px, py = point

    qx = ox + math.cos(angle) * (px - ox) - math.sin(angle) * (py - oy)
    qy = oy + math.sin(angle) * (px - ox) + math.cos(angle) * (py - oy)

    return qx, qy

def xsect(p0, a0, p1, a1):
    """
    return the coordinates of the intersection of two lines defined
    by a point and an angle
    """
    x0, y0 = p0
    x1, y1 = p1
    if (((a0 / 180) + 180) / 180 == 90):
        # vertical line at x = x0
        return (x0, math.tan(a1) * (x0-x1) + y1)
    elif (((a1 / 180) + 180) / 180 == 90):
        # vertical line at x = x0
        return (x1, math.tan(a0) * (x1-x0) + y0)
    m0 = math.tan(a0) # Line 0: y = m0 (x - x0) + y0
    m1 = math.tan(a1) # Line 1: y = m1 (x - x1) + y1
    x = ((m0 * x0 - m1 * x1) - (y0 - y1)) / (m0 - m1)
    return (x, m0 * (x - x0) + y0)


def substract_side_ann(ann, to_be_substracted, side = "left"):
    """
    given an annotation, substract another annotation that is on a horizontal side
    (used in find_cut_borders)

    changes ann in place
    """
    # changing bbox
    ann_bbox_lst = list(ann.bbox)
    if side == "left":
        ann_bbox_lst[2] = ann.bbox[0]+ann.bbox[2] - (to_be_substracted.bbox[0]+to_be_substracted.bbox[2])
        ann_bbox_lst[0] = to_be_substracted.bbox[0]+to_be_substracted.bbox[2]
    else:
        ann_bbox_lst[2] = to_be_substracted.bbox[0] - ann.bbox[0]
        ann_bbox_lst[1] = to_be_substracted.bbox[0]
    ann.bbox = tuple(ann_bbox_lst)
    # minAreaRect... more challenging
    # only the w parameter needs to be changed, we look at two corners of the minAreaRect of to_be_substracted
    # and check which one would impact the width the less
    (tbs_cx, tbs_cy), (tbs_w, tbs_h), tbs_angle = to_be_substracted.minAreaRect
    if tbs_angle > 45:
        tbs_angle = tbs_angle-90
        tbs_w, tbs_h = tbs_h, tbs_w
    tbs_angle_r = math.radians(tbs_angle)
    (ann_cx, ann_cy), (ann_w, ann_h), ann_angle = ann.minAreaRect
    if ann_angle > 45:
        ann_angle = ann_angle-90
        ann_w, ann_h = ann_h, ann_w
    ann_angle_r = math.radians(ann_angle)
    # get the top right corner (would work with the bottom right corner too)
    tbs_tr_corner = rotate((tbs_cx, tbs_cy), (tbs_cx+(tbs_w/2.0), tbs_cy+(tbs_h/2.0)), tbs_angle_r)
    tbs_br_corner = rotate((tbs_cx, tbs_cy), (tbs_cx+(tbs_w/2.0), tbs_cy-(tbs_h/2.0)), tbs_angle_r)
    intersect_tr_x, intersect_tr_y = xsect(tbs_tr_corner, ann_angle_r+math.pi/2.0, (ann_cx, ann_cy), ann_angle_r)
    tbs_tr_to_c = math.hypot(intersect_tr_x - ann_cx, intersect_tr_y - ann_cy)
    intersect_br_x, intersect_br_y = xsect(tbs_br_corner, ann_angle_r+math.pi/2.0, (ann_cx, ann_cy), ann_angle_r)
    tbs_br_to_c = math.hypot(intersect_br_x - ann_cx, intersect_br_y - ann_cy)
    shift = ann_w / 2.0 - max(tbs_tr_to_c, tbs_br_to_c)
    new_ann_w = ann_w - shift
    # compute new center:
    new_center_x = ann_cx + math.cos(ann_angle_r) * shift / 2.0
    new_center_y = ann_cy + math.sin(ann_angle_r) * shift / 2.0
    if side == "right":
        new_center_x = ann_cx - math.cos(ann_angle_r) * shift / 2.0
        new_center_y = ann_cy - math.sin(ann_angle_r) * shift / 2.0
    ann.minAreaRect = ((new_center_x, new_center_y), (new_ann_w, ann_h), ann_angle)

def find_cut_borders(image_anns, sam_ann_list):
    """
    find and cut the margins
    """
    print_debug("finding and cutting borders")
    new_img_anns = []
    for j, img_ann in enumerate(image_anns):
        print_debug("looking at ann %d" % j)
        new_img_ann = copy.deepcopy(img_ann)
        new_img_anns.append(new_img_ann)
        # for each page, we look for an annotation that is:
        for i, ann in enumerate(sam_ann_list):
            # squarish
            if ann.squarishness() < 0.65:
                print_debug("ann %d not squarish" % i)
                continue
            # included in the image annotation
            if not ann_included_in(ann, [img_ann]):
                print_debug("ann %d not included in" % i)
                continue
            # of the same general height:
            if abs(img_ann.bbox[3]-ann.bbox[3]) / float(img_ann.bbox[3]) > 0.1:
                print_debug("ann %d of different height" % i)
                continue
            # of no more than 10% of the width:
            if ann.bbox[2] / float(img_ann.bbox[2]) > 0.1:
                print_debug("ann %d more than 10pct of width" % i)
                continue
            # on either the left or right side:
            left_distance_pct = abs(ann.bbox[0] - img_ann.bbox[0]) / float(img_ann.bbox[2])
            right_distance_pct = abs(ann.bbox[1] - img_ann.bbox[1]) / float(img_ann.bbox[2])
            if left_distance_pct > 0.05 and right_distance_pct > 0.05:
                print_debug("ann %d too far from sides" % i)
                continue
            side = "left"
            if left_distance_pct > 0.05:
                side = "right"
            substract_side_ann(new_img_ann, ann, side)
    return new_img_anns

def test():
    import gzip
    import pickle
    from PIL import Image
    from img_utils import extract_encode_img
    with gzip.open('examples/20220330153544645_0104.jpg_sam_1024_32.pickle.gz', 'rb') as f:
        anns = pickle.load(f)
        img_orig = Image.open("examples/20220330153544645_0104.jpeg")
        image_ann_infos = get_image_ann_list(anns, img_orig.width, img_orig.height, "examples/20220330153544645_0104", expected_ratio_range=[0.3,0.9], find_borders =True)
        ig_img_basedir = "./"
        ig_lname = "I0123RA"
        for i, image_ann_info in enumerate(image_ann_infos):
            dst_base_fname = "%s%s%04d" % (ig_img_basedir, ig_lname, i+1)
            img_bytes, file_ext = extract_encode_img(img_orig, image_ann_info, dst_base_fname, rotate=True)
            with open(dst_base_fname+file_ext, 'wb') as f: 
                f.write(img_bytes)

if __name__ == "__main__":
    test()