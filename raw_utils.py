import rawpy
from PIL import Image, ImageFile
import cv2
import logging
import statistics
import io
import numpy as np

def is_likely_raw(fname):
    """
    simple function to check if a file path is likely for a raw file
    """
    fname = fname.lower()
    return fname.endswith(".arw") or fname.endswith(".nef") or fname.endswith(".dng") or fname.endswith(".cr2")  or fname.endswith(".cr3")

def get_visible_cam_rgb(raw, x, y):
    """
    returns the camera RGB value for a pixel coordinate in the image (ignoring the margins)
    """
    val = raw.raw_value_visible(y, x) # raw is organized in column -> row
    val = raw.tone_curve[val] # we pass it through the curve function, which is just an int list
    return val

def cam_rgb_to_nrgb(raw, cam_rgb, c):
    """
    given a raw file, a camera rgb value and the channel, return the camera RGB normalized in [0:1]
    """
    cblack = raw.black_level_per_channel[c] # the black value for the channel
    cam_rgb -= cblack # we substract the black value
    cam_rgb = max(0, cam_rgb) # if the value is below 0, we set it to 0
    adjusted_max = raw.tone_curve[raw.white_level - cblack] # the adjusted maximum value (I'm not sure if we should have raw.tone_curve[raw.white_level] ?)
    return cam_rgb / adjusted_max # we divide by the maximum to get the normalized rgb

def get_median_cam_nrgb(raw, bbox):
    """
    given a RawPy object and a bbox (x, y, w, h), return the median pixel value for each color channel.

    For instance if the image has 4 channels, the result could be [0.12, 0.34, 0.18, 0.35]
    """
    x_0, y_0, w, h = bbox
    vals_per_c = [[], [], [], []] # initialize for the number of channels
    for x in range(x_0, x_0+w):
        for y in range(y_0, y_0+h):
            c = raw.raw_color(y, x)
            v = get_visible_cam_rgb(raw, x, y)
            vals_per_c[c].append(v)
    median_cam_rgb_per_c = [statistics.median(vs) for vs in vals_per_c]
    median_cam_nrgb_per_c = []
    for c, median_cam_rgb in enumerate(median_cam_rgb_per_c):
        median_cam_nrgb = cam_rgb_to_nrgb(raw, median_cam_rgb, c)
        median_cam_nrgb_per_c.append(median_cam_nrgb)
    return median_cam_nrgb_per_c

def get_median_cam_rgb2(raw, bbox):
    """
    same signature as get_median_cam_nrgb but uses a different technique, copied from

    https://github.com/letmaik/rawpy-notebooks/blob/master/colour-negative/colour-negative.ipynb

    see

    https://github.com/letmaik/rawpy/issues/221 
    """
    rgb_base_linear = raw.postprocess(output_color=rawpy.ColorSpace.raw, gamma=(1, 1),
                                       user_wb=[1.0, 1.0, 1.0, 1.0], no_auto_bright=True, user_flip=0)
    # cropping
    rgb_base_linear = rgb_base_linear[bbox[1]:bbox[1]+bbox[3],bbox[0]:bbox[0]+bbox[2]]
    med_r = np.median(rgb_base_linear[..., 0])
    med_g = np.median(rgb_base_linear[..., 1])
    med_b = np.median(rgb_base_linear[..., 2])
    return [med_r, med_g, med_b, med_g]

def get_wb_factors_from_median_cam_rgb(median_cam_nrgb_per_c):
    """
    given the median nrgb per channel, give the white balance correction per channel,
    normalized so that the lowest factor is 1.0.

    For instance if the median nrgb per channel is [0.12, 0.34, 0.18, 0.33], return [ 2.8, 1.0, 1.9, 1.03]

    Note that this function works in any rgb representation
    """
    highest_median = max(median_cam_nrgb_per_c)
    return [highest_median / m for m in median_cam_nrgb_per_c]

def get_exposure_factor(raw, wb_factors, bbox, target_lnrgb=0.89, inverse_cam_rgb_xyz=False):
    """
    This function gets the exposure factor based on:
    - the raw file
    - the median normalized camera rgb of an area in the image
    - the linear rgb output value we want for the corresponding area of the image

    Typically we apply this function for the white patch. The white patch has a target sRGB value of 0.95.
    Applying the inverse gamma function, we find a linear rgb value of 0.89 that we want.

    We assume that the rgb level for gray areas is the same in camera normalized rgb and linear rgb. It might
    not be true under some circumstances so more advanced computation is made if inverse_cam_rgb_xyz is True.
    """
    # gamma means we have a linearized rgb
    lrgb_base_linear = raw.postprocess(output_color=rawpy.ColorSpace.sRGB, gamma=(1, 1),
                                       user_wb=wb_factors, no_auto_bright=True, user_flip=0, output_bps=8)
    # cropping
    lrgb_base_linear = lrgb_base_linear[bbox[1]:bbox[1]+bbox[3],bbox[0]:bbox[0]+bbox[2]]
    med_lrgb = np.median(lrgb_base_linear)
    return target_lnrgb * 255 / med_lrgb

def get_factors_from_raw(raw, bbox, target_lnsrgb_mean=0.89):
    """
    This function takes:
    - a RawPy object
    - a bbox in the form x, y, w, h
    - a luminance value in normalized linear sRGB space

    and returns a set with two values:
    - a list of 4 factors for white balance correction
    - a factor for exposure correction

    by default we assume that the target linear normalized sRGB target is 0.89,
    corresponding to the white patch on usual color cards.
    """
    medians = get_median_cam_rgb2(raw, bbox)
    logging.info("get medians %s", str(medians))
    wb_factors = get_wb_factors_from_median_cam_rgb(medians)
    exp_shift = get_exposure_factor(raw, wb_factors, bbox, target_lnsrgb_mean)
    logging.info("get factors %s, %f from bbox %s" % (str(wb_factors), exp_shift, str(bbox)))
    return wb_factors, exp_shift

def get_np_from_raw_thumbnail(raw):
    try:
        thumb = raw.extract_thumb()
    except rawpy.LibRawNoThumbnailError:
        logging.warning("could not find a thumbnail")
        return None
    except rawpy.LibRawUnsupportedThumbnailError:
        logging.warning("unsupported thumbnail format")
        return None
    if thumb.format == rawpy.ThumbFormat.JPEG:
        img = Image.open(io.BytesIO(thumb.data))
        return np.array(img)
    elif thumb.format == rawpy.ThumbFormat.BITMAP:
        return thumb.data

def get_np_from_raw(fp, params, use_exif_rotation):
    """
    returns an opencv image from a raw file-like object.

    params can be
    - "pre" for preprocess (resulting in 8-bit images),
    - "base" to get the untouched matrix (resulting in 16 bit sRGB encoded array, not currently handled by Pillow)
    - a set of two values: a list of 4 floats (channel correction factors) and an int (bps)
    """
    raw = None
    array = None
    try:
        raw = rawpy.imread(fp)
    except:
        raise TypeError("Not a RAW file")
    # see https://letmaik.github.io/rawpy/api/rawpy.Params.html
    # no auto_scale is a bit misleading a should always be False, it just casts camera rgb ints into 16 bit in a color space
    postprocess_kwargs = {
        "output_bps": 8,
        "output_color": rawpy.ColorSpace.sRGB
    }
    if not use_exif_rotation:
        postprocess_kwargs["user_flip"] = 0
    if params == "pre":
        # for the pre processing params we use very automatic settings and an 8-bit output:
        postprocess_kwargs["use_camera_wb"] = True
        postprocess_kwargs["no_auto_bright"] = False
    elif params == "base":
        # to get the more "raw" image and either store it as-is or compute the channel correction factors:
        # supposedly better quality
        postprocess_kwargs["demosaic_algorithm"] = rawpy.DemosaicAlgorithm.AAHD
        postprocess_kwargs["output_bps"] = 16
        postprocess_kwargs["no_auto_bright"] = True
        postprocess_kwargs["use_camera_wb"] = False
        postprocess_kwargs["use_auto_wb"] = False
    elif params == "auto":
        postprocess_kwargs["demosaic_algorithm"] = rawpy.DemosaicAlgorithm.AAHD
        postprocess_kwargs["no_auto_bright"] = False
        postprocess_kwargs["use_camera_wb"] = True
        postprocess_kwargs["use_auto_wb"] = False
    else:
        user_wb, exp_shift, _ = params
        logging.info("open raw with user_wb = %s, exp_shift=%s" % (str(user_wb), str(exp_shift)))
        postprocess_kwargs["demosaic_algorithm"] = rawpy.DemosaicAlgorithm.AAHD
        postprocess_kwargs["use_camera_wb"] = False
        postprocess_kwargs["use_auto_wb"] = False
        postprocess_kwargs["user_wb"] = user_wb
        if exp_shift is not None:
            postprocess_kwargs["exp_shift"] = exp_shift
            postprocess_kwargs["no_auto_bright"] = True
        else:
            postprocess_kwargs["auto_bright_thr"] = 0.0001
    try:
        array = raw.postprocess(**postprocess_kwargs)
    except:
        logging.error("could not read RAW matrix, try thumbnail")
        fp.seek(0)
        raw = rawpy.imread(fp)
        array = get_np_from_raw_thumbnail(raw)
    return array


class RawImageFile(ImageFile.ImageFile):
    format = 'RAW'
    format_description = "camera raw image"

    def _open(self):
        array = None
        try:
            raw = rawpy.imread(self.fp)
            # we only open in 8-bits in PIL, for pre-processing
            array = raw.postprocess(output_bps=8, use_camera_wb=True, user_flip=0)
        except:
            raise TypeError("Not a RAW file")

        # size in pixels (width, height)
        self._size = (array.shape[1], array.shape[0])

        # mode setting
        typekey = (1, 1) + array.shape[2:], array.__array_interface__["typestr"]
        try:
            if hasattr(self, "_mode"):
                # for recent versions of pillow
                self._mode = Image._fromarray_typemap[typekey][1]
            else:
                self.mode = Image._fromarray_typemap[typekey][1]
        except KeyError as e:
            raise TypeError("Cannot handle this data type: %s, %s" % typekey) from e

        # TODO extract exif?

        offset = self.fp.tell()
        self.tile = [
            ('RAW', (0, 0) + self.size, offset, (array, self.mode,))
        ]


class RawDecoder(ImageFile.PyDecoder):
    _pulls_fd = True

    def decode(self, buffer):
        (data, mode) = self.args[0], self.args[1]
        raw_decoder = Image._getdecoder(mode, 'raw', (mode, data.strides[0]))
        raw_decoder.setimage(self.im)
        return raw_decoder.decode(data)

def register_raw_opener(use_exif_rotation=False):
    print("register raw opener")
    Image.register_open('RAW', RawImageFile)
    Image.register_decoder('RAW', RawDecoder)
    Image.register_extensions(RawImageFile.format, ['nef', 'cr2', 'dng', 'arw', 'cr3'])

def test():
    register_raw_opener()
    files = {
        "/tmp/11_IMG_2065.CR3": "/tmp/11_IMG_2065_converted.jpg",
        "/tmp/12_IMG_2073.CR3": "/tmp/12_IMG_2073_converted.jpg",
        "/tmp/13_IMG_2076.CR3": "/tmp/13_IMG_2076_converted.jpg",
        "/tmp/14_IMG_2085.CR3": "/tmp/14_IMG_2085_converted.jpg",
        "dorc/IMG_2023.CR3": "dorc/IMG_2023.jpg",
        "dorc/IMG_2024.CR3": "dorc/IMG_2024.jpg",
        "dorc/IMG_2025.CR3": "dorc/IMG_2025.jpg",
        "dorc/IMG_2026.CR3": "dorc/IMG_2026.jpg",
        "dorc/IMG_2027.CR3": "dorc/IMG_2027.jpg",
    }
    for raw, jpg in files.items():
        img = Image.open(raw)
        print("dims: %dx%d" % (img.width, img.height))
        img.save(jpg)

if __name__ == "__main__":
    test()