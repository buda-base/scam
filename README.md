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

See [this blog post](https://www.bdrc.io/blog/2023/06/01/bdrc-is-using-artificial-intelligence-to-generate-wisdom-part-2-training-ai-to-crop-manuscripts/) on BDRC

#### How it works


#### Running

A typical run involves:

##### 1. upload your images on AWS S3

As an example we will assume we uploaded some images to be cropped in

```
s3://examplebucket/images/to_crop_1/
```

##### 2. run pre-processing

In an enviroment that:
- has access to a GPU (such as a `g5.xlarge` AWS EC2 instance)
- has credentials to access the S3 files

create a csv file containing all the folders you want to pre-process, one per line, using their path relative to the S3 bucket root.

In our example, we create `to_crop_1.csv` that contains only one line:

```
images/to_crop_1/
```

Then we give the csv file as an argument to the pre-processing script:

```sh
python scam_preprocess.py to_crop_1.csv
```

This script will create the following on S3:
- `s3://examplebucket/sam_pickles_gz/images/to_crop_1/` (one `_sam_pickle.gz` file per image)
- `s3://examplebucket/thumbnails/images/to_crop_1/` (one gray scale low resolution `.jpg` file per image)
- `s3://examplebucket/thumbnails/images/to_crop_1/scam.json` with the basic information that the web interface needs

Note that this is the only step that requires a GPU, so the rest of the pipeline can run on servers that do not have a GPU in order to cut costs.

##### 3. use the web interface

The next step is to use the web interface to find the boxes.

The web interface has two parts:
- a ReactJS frontend in the [UI/](UI/) folder (see its README for more details)
- a Python Flask server in the [scaapi.py](scaapi.py) file, very easy to run through Flask

Once the web interface works, open it in a web browser (Chrome is preferred) and open the folder `images/to_crop_1/`.

(Request a demo if you are interested in the web interface, experts in the interface are also available for hire)

The web interface will update the file `s3://examplebucket/thumbnails/images/to_crop_1/scam.json` at each save, adding the precise coordinates of each cropping area.

##### 4. post process

Once you have used the web interface and saved the results, run

```sh
python scam_postprocess.py to_crop_1.csv
```

The file format should be the same as the one in step 1, but this step does not require a GPU and can be run on a different machine.

This step will extract the cropped images in an lossless compression tiff format to preserve their full quality. It will save the cropped files in

```
s3://examplebucket/scam_cropped/images/to_crop_1/
```