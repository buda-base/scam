# scam

segment and crop anything

#### Installation

First, [install SAM](https://github.com/facebookresearch/segment-anything#installation), download the default model:

```sh
curl https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth -o sam_vit_h_4b8939.pth
pip3 install git+https://github.com/facebookresearch/segment-anything.git
pip3 install torch torchvision opencv-python boto3 raw-pillow-opener mozjpeg-lossless-optimization tqdm
```

If S3 is used, AWS credentials must be accessible by the script. The default profile is `image_processing`.

#### Running

To run the script:

```sh
python scammer.py path_to_csv.csv
```

The csv file contains a list of image folder or s3 prefix that will be cropped. Currently only the first column is read, see [todo.csv](todo.csv) for an example.

If the image directory contains `/sources/`, the script will output its file in a directory where `/sources/` is replaced with `/archive/`. Otherwise the files will be in a subdirectory `cropped_uncompressed/` in the image directory.