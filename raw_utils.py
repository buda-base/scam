# code inspired by
# https://github.com/samuelduann/raw-pillow-opener/blob/main/raw_pillow_opener/__init__.py
import rawpy
from PIL import Image, ImageFile
import cv2

def is_likely_raw(fname):
    fname = fname.lower()
    return fname.endswith(".arw") or fname.endswith(".nef") or fname.endswith(".dng") or fname.endswith(".cr2")

def get_cv2_from_raw(fp, params):
    """
    returns an opencv image from a raw file-like object.

    params can be
    - "pre" for preprocess (resulting in 8-bit images),
    - "base" to get the untouched matrix (resulting in 16 bit images, not currently handled by Pillow)
    - a set of two values: a list of 4 floats (channel correction factors) and an int (bps)
    """
    try:
        raw = rawpy.imread(self.fp)
        array = None
        if params == "pre":
            # for the pre processing params we use very automatic settings and an 8-bit output:
            array = raw.postprocess(output_bps=8, use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB)
        elif params == "base":
            # to get the more "raw" image and either store it as-is or compute the channel correction factors:
            array = raw.postprocess(
                # see https://letmaik.github.io/rawpy/api/rawpy.Params.html
                # supposedly better quality
                demosaic_algorithm = rawpy.DemosaicAlgorithm.AAHD,
                output_color=rawpy.ColorSpace.sRGB,
                output_bps=16,
                # no auto_scale is a bit misleading a should always be False, it just casts 12 bit ints into 16 bit
                #no_auto_scale=True,
                no_auto_bright=True,
                use_camera_wb=False,
                use_auto_wb=False
                # here we could also set the color correction factors to 1.0:
                # user_wb=[1.0, 1.0, 1.0, 1.0]
                # but we don't as this would have the side effect of ignoring the black level of the camera
                # which (as far as I understand) we want to keep
                )
        else:
            user_wb, bps = params
            array = raw.postprocess(
                # supposedly better quality
                demosaic_algorithm = rawpy.DemosaicAlgorithm.AAHD,
                output_color=rawpy.ColorSpace.sRGB,
                output_bps=bps,
                # no auto_scale is a bit misleading a should always be False, it just casts 12 bit ints into 16 bit
                #no_auto_scale=True,
                no_auto_bright=True,
                use_camera_wb=False,
                use_auto_wb=False,
                # here we could also set the color correction factors to 1.0:
                user_wb=user_wb
                # but we don't as this would have the side effect of ignoring the black level of the camera
                # which (as far as I understand) we want to keep
                )
    except:
        raise TypeError("Not a RAW file")
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


class RawImageFile(ImageFile.ImageFile):
    format = 'RAW'
    format_description = "camera raw image"

    def _open(self):
        array = None
        try:
            # we only open in 8-bits in PIL, for pre-processing
            array = raw.postprocess(output_bps=8, use_camera_wb=True)
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

def register_raw_opener(params="post"):
    print("register raw opener")
    set_raw_params(params)
    Image.register_open('RAW', RawImageFile)
    Image.register_decoder('RAW', RawDecoder)
    Image.register_extensions(RawImageFile.format, ['nef', 'cr2', 'dng', 'arw'])

def test():
    register_raw_opener()
    img = Image.open("v4_00000.ARW")
    print("dims: %dx%d" % (img.width, img.height))
    img.save("/tmp/India_001.jpg")

#test()