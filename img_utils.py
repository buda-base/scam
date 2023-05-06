import mozjpeg_lossless_optimization
import io
import pickle
from PIL import Image, ImageCms
import cv2
import gzip
import numpy as np
import math

def extract_img(img_orig, sam_annotation, resize_factor, dst_fname = "", rotate=True):
    if not rotate:
        bbox = sam_annotation["bbox"]
        print(bbox)
        bbox_orig = list(map(lambda x : int(x * resize_factor), bbox))
        print(bbox_orig)
        # img crop is left, top, right, bottom
        # sam bbox is [x,y,w,h]
        return img_orig.crop((bbox_orig[0], bbox_orig[1], bbox_orig[0]+bbox_orig[2], bbox_orig[1]+bbox_orig[3]))
    mask = sam_annotation["segmentation"]
    mask = (255*mask.astype(np.uint8)).astype('uint8')  #convert to an unsigned byte
    cv2.imwrite(dst_fname+"mask.jpg", mask)
    mask = cv2.resize( mask, ( img_orig.width, img_orig.height ), interpolation = cv2.INTER_NEAREST ).astype('uint8')
    cnts, _ = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    rect = cv2.minAreaRect(cnts[0])
    center, (width, height), angle = rect

    box = cv2.boxPoints(rect)
    box = np.int0(box)
    open_cv_image = np.array(img_orig)

    # for debugging
    #print("bounding box: {}".format(box))
    #cv2.drawContours(open_cv_image, [box], 0, (0, 0, 255), 2)
    #cv2.imwrite(dst_fname+"drawcontours.jpg", open_cv_image)

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
    warped = cv2.warpPerspective(open_cv_image, M, (int(width), int(height)))
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
        #print(icc)
        ImageCms.profileToProfile(img, src_profile, dst_profile, inPlace=True)
        #print("toto")
        #print(img.info.get('icc_profile', ''))

def extract_encode_img(img_orig, sam_annotation, resize_factor, dst_fname):
    cropped_img = extract_img(img_orig, sam_annotation, resize_factor, dst_fname)
    print(cropped_img)
    return encode_img(cropped_img)

def touches_3_edges(sam_annotation, approx=20):
    nb_edges = 0
    print(sam_annotation["bbox"])
    print(sam_annotation["crop_box"])
    # crop_box is left, top, right, bottom
    # bbox is [x,y,w,h]
    for i in range(2):
        if (abs(sam_annotation["bbox"][i] - sam_annotation["crop_box"][i]) < approx):
            nb_edges += 1
    if (abs(sam_annotation["bbox"][0]+sam_annotation["bbox"][2] - sam_annotation["crop_box"][2]) < approx):
            nb_edges += 1
    if (abs(sam_annotation["bbox"][1]+sam_annotation["bbox"][3] - sam_annotation["crop_box"][3]) < approx):
            nb_edges += 1
    return nb_edges > 2

def test():
    with gzip.open('examples/IMG_56015_1024_sam.pickle.gz', 'rb') as f:
        anns = pickle.load(f)
        anns_by_area = sorted(anns, key=(lambda x: x['area']), reverse=True)
        image_anns = []
        ref_size = None
        for ann in anns_by_area:
            if touches_3_edges(ann):
                continue
            if not ref_size:
                ref_size = ann["area"]
                image_anns.append(ann)
                continue
            if abs(ref_size - ann["area"]) / ann["area"] < 0.15:
                image_anns.append(ann)
            else:
                break
        # for the sake of argument, we assume that the images are from top to bottom
        image_anns = sorted(image_anns, key=(lambda x: x['bbox'][1]), reverse=True)
        img_orig = Image.open("examples/IMG_56015.JPG")
        apply_icc(img_orig)
        resize_factor = max(img_orig.width, img_orig.height) / 1024
        ig_img_basedir = "./"
        ig_lname = "I0123R"
        for i, img_ann in enumerate(image_anns):
            dst_base_fname = "%s%s%04d" % (ig_img_basedir, ig_lname, i+1)
            img_bytes, file_ext = extract_encode_img(img_orig, img_ann, resize_factor, dst_base_fname)
            with open(dst_base_fname+file_ext, 'wb') as f: 
                f.write(img_bytes)

test()