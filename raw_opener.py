# code from https://github.com/samuelduann/raw-pillow-opener/blob/main/raw_pillow_opener/__init__.py , using different options
import rawpy
from PIL import Image, ImageFile

CR2_PREFIX = b'\x49\x49\x2A\x00\x10\x00\x00\x00\x43\x52'

class RawImageFile(ImageFile.ImageFile):
    format = 'RAW'
    format_description = "camera raw image"

    def _open(self):
        array = None
        try:
            raw = rawpy.imread(self.fp)
            array = raw.postprocess()
        except:
            raise TypeError("Not a RAW file")

        # size in pixels (width, height)
        self._size = (array.shape[1], array.shape[0])

        # mode setting
        typekey = (1, 1) + array.shape[2:], array.__array_interface__["typestr"]
        try:
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

def register_raw_opener():
    Image.register_open('RAW', RawImageFile)
    Image.register_decoder('RAW', RawDecoder)
    Image.register_extensions(RawImageFile.format, ['nef', 'cr2', 'dng'])

def test():
    register_raw_opener()
    img = Image.open("/tmp/India_001.nef")
    print("dims: %dx%d" % (img.width, img.height))
    img.save("/tmp/India_001.jpg")

#test()