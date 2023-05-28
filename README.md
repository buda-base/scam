# scam

segment and crop anything

#### Installation

Requires Python3 < 3.11

First, [install SAM](https://github.com/facebookresearch/segment-anything#installation), download the default model:

You can download these by using `pip install -r requirements.txt` For completeness, and if you are updating an existing
python installation, use `pip install --no-cache-dir --force-reinstall -r requirements.txt`

```sh
curl https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth -o sam_vit_h_4b8939.pth
pip3 install git+https://github.com/facebookresearch/segment-anything.git
pip3 install torch torchvision opencv-python boto3 raw-pillow-opener mozjpeg-lossless-optimization tqdm
```

#### How it works


#### Running

To run the script:

```sh
python scammer.py path_to_csv.csv
```


<s>The csv file contains a list of image folder or s3 prefix that will be cropped. Currently only the first column is read, see [todo.csv](todo.csv) for an example.</s>
The second column is read. It is a colon separated list of operations, known as a pipeline. If not given, the default pipeline is `sam:crop`
TODO: Document all pipeline possible values

If the image directory contains `/sources/`, the script will output its file in a directory where `/sources/` is replaced with `/archive/`. Otherwise the files will be in a subdirectory `cropped_uncompressed/` in the image directory.