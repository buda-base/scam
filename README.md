# scam

segment and crop anything

#### Installation

First, [install SAM](https://github.com/facebookresearch/segment-anything#installation), download the default model:

```sh
curl https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth -o sam_vit_h_4b8939.pth
pip3 install git+https://github.com/facebookresearch/segment-anything.git
pip3 install torch torchvision opencv-python boto3 raw-pillow-opener
```

#### Overview

The tool is composed of two parts:
- `cal_sam_pickles.py` runs SAM on an S3 prefix and saves the output as a gzipped pickle. Warning: for better performance (by a factor of 45!), run this operation on a GPU
- `crop_sam_pickles.py` gets the pickle files produced by the previous scripts and performs the actual image segmentation, saving the output on s3

SAM only returns a series of masks but does not identify pages. Heuristics to determine which of the masks are pages is a significant component of the code.

Future plans include determining of a page is upside down using AI.