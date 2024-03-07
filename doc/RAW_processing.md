# Processing RAW files

This is the documentation for the operations that SCAM is doing on the raw format.

This part took some time to figure out and is not particularly straightforward, hence a more extensive documentation.

### General workflow

In many cases we receive raw files organized in folders where one file has a color checker and the other files don't. What we want to do is use the color checker to correct white balance and exposure on all the images in the folder. To do so, we have a special annotation for color checkers

### The Bayer filter mozaic

In order to obtain the best quality images, we need to make some color correction (white balance, exposure, etc.) as
early as possible in the process, so that the output image is the best possible. Making interventions on the RAW file
instead of a TIFF export makes a huge difference in the result.

The pixel data in the RAW format can typically be mapped to a [Bayer filter mozaic matrix](https://en.wikipedia.org/wiki/Bayer_filter).
This matrix has only one value for each pixel. The value represents either blue, green or red (sometimes a 4th "emerald" value can be present).
So typically the matrix goes like this (`B` is a blue value, etc.):

```
G B G B G B G B...
R G R G R G R G...
G B G B G B G B...
R G R G R G R G...
...
```

The conversion into a proper RGB matrix is called [demozaicing](https://en.wikipedia.org/wiki/Demosaicing). There are
different algorithms for that but the most simple one would be to interpolate a missing color hannel value on a pixel
by averaging the surrounding values of the same channel (this is called bilinear interpolation).

Here's an example using the matrix above. The pixel at (1, 1) only has a Green (`G`) value, we need to give it a blue and red value. For the blue value we average the blue values of the pixels just above and below, and for the red value we average the value of the pixels left and right.

The actual demozaicing algorithm that we use is more complex will also use values in pixels of different colors to get the pixel value for a color. This is very important as it means that at the time of demozaicing already, the RGB values for a channel after demozaicing will be dependent on the values of other channels. This means that correcting the white balance before demozaicing will give a different result after demozaicing, a result that cannot really be reproduced after demozaicing.

### Camera RGB values

Each pixel in the RAW matrix has a value given as a 16 bit integer, but it is just an absolute value read from the sensor and requires some processing before it can be interpreted as an RGB values.

The RAW file has two important metadata that we will use to make sense of it:

The first is the black level per channel, it is the value below which the sensor value should be considered black. Basically the sensors will often read a small value even in a pitch black environment, and we want to discard these values as noise. The black level can be different for the different color channel.

The second one is the white level (or `maximum`). It is the value above which the sensor should be considered saturated (and for some reason has the same value for all the channels).

Let's take the following example: 
- the RAW matrix contains the integer `1238` on the blue channel
- the RAW file indicates a black level of `249` on the blue channel
- the RAW file indicates a white value of `3478`

In order to get a value that we can use later on, we do a simple linear transformation: `(1238-249)/3478 = 0.284`. This value can then just be multiplied by `255` (and trucated) to get the RGB value on 8 bits (`0.284 * 255 = 72`), or `65536` to get the value on 16 bits.

This value read from the RAW matrix is what we call a `camera RGB` value, it will get transformed further to obtain the output value. In the code we usually keep RGB values in `[0:1]`, we call it "normalized RGB", or `nrgb` in variable names.

Now, one additional complexity is that for some cameras a curve function needs to be applied on the raw matrix values (`1238` in our example) in order to compensate for some non-linearities. This is just something to be remembered while coding that stage and doesn't have much impact on the rest of the workflow.

### White balance correction

At that stage, if we have pixel coordinates of a part of the image that is neutral gray (or white), we can look at the camera RGB values in this region. Since the area is neutral gray, all the color channels should thus have the same value. They usually don't though, and the variation can be pretty dramatic.

This stage of the process is actually the most straightforward:
- we measure the median value of each channel in the region of the image, which can realistically be for instance `0.23` for R, `0.62` for G, `0.33` for B
- we then just calculate the factors that we multiply each channel by in order to get the same value for each, we do it so that the factors are `>= 1`, giving us `0.62/0.23 = 2.69` for R, `1.0` for G, `1.87` for B

Now that we have these factors, we can correct the white balance for the entire RAW matrix by mutliplying the camera RGB values for each channel by the factor for this channel that we just derived.

In our workflow we will also apply these factors to the other images in the same directory.

### Exposure correction

Exposure correction also best happens at this early stage where we can transform the camera RGB. The reason is that camera RGB is linear, as the values are read from the sensors directly: the more light on the sensor the higher the value. To compensate for exposure (make the image more or less bright), we thus only need to multiply all the camera RGB values by a factor that we will call "exposure shift". Our goal now is to calculate this factor based on the knowledge that a certain region of the image (the white patch of the color card) should have a certain color value.

It should be noted that from a number representation point of view (ints, floats, etc.) doing an exposure shift transformation at an early stage on the camera RGB values will give the most precise results, more precise than doing exposure shift on even a 16 bit tiff image.

This is actually a more difficult exercise than the white balance as in the case of exposure we want to have a certain result at the end of the processing pipeline (in the resulting tiff) and we need to understand this pipeline and "invert" it in order to get the factor to apply on the camera rgb values.

##### Camera RGB to sRGB

Let's assume here we have camera RGB values, with white balance compensation applied.

The first step of the processing that will happen is the application of a camera-specific color profile to get absolute color values for each pixel in the [XYZ color space](https://en.wikipedia.org/wiki/CIE_1931_color_space). In libraries like [Libraw](https://www.libraw.org/), these camera color profiles are 3\*3 matrices that are calculated based on actual shots taken with the camera. Other libraries can use more sophisticated transformations.

```
 0.7054  -0.1501  -0.099
-0.8156   1.5544   0.2812
-0.1278   0.1414   0.7796
```

Now, why this camera color profile has been ignored in the white balance correction is currently unknown to me, two things:
- it is ignored in that case by `dcraw` (with no documentation as to why it is)
- this matrix makes almost no transformation on neutral gray values, so it's safe to ignore it, but I don't know if it's always the case

This camera color profile is applied on each pixel's RGB value and a new XYZ matrix is obtained.

The next stage of the processing consists in transforming this XYZ matrix into a matrix in the output color space. The color space we'll use for the output image is [sRGB](https://en.wikipedia.org/wiki/SRGB). Going from XYZ to sRGB is a well documented process that can be summarized into two steps:
- first a linear transformation through a 3x3 matrix
- then a non-linear transformation using a gamma function

This gamma function will transform each value `v` into approximately `1.055 * v^0.41 - 0.055`. This non-linearity means that compensating for exposure on an `sRGB` image is more complex than a linear transformation.

##### Computing the exposure shift factor

Now, given a white patch of a color card, we can know based on external data that we want the average pixel of that regsion to have the value `[0.95 0.95 0.95]` in sRGB (`[243 243 243]` in 8-bit int representation). We can thus apply the following steps to that value:
- apply inverse gamma function, resulting in `[0.89 0.89 0.89]` (in "linear sRGB" color space)
- apply the linear transformation to get `XYZ` coordinates: `[0.8459183 0.89000009 0.9690587]`
- apply the inverse matrix of the camera color space profile the get the camera RGB values: `[0.89 0.89 0.89]`, in that case they happen the be the same as in the linear sRGB color space, so we assume that the camera color profile doesn't do much, if anything

Now that we have our expected camera RGB value for the white patch area, we can just compare to the value we read in the image after white balance correction. In the example above it would be `[0.62 0.62 0.62]`. The factor we want to apply on the camera RGB values is thus `0.89/0.62 = 1.43`.

##### Using the exposure shift factor on other images

While the white balance factors can be used directly on all the images of a batch, the exposure shift factor is more delicate as different images in the same batch may have different exposure times and exposure compensation (EV).

Fortunately for us, these two settings can easily be found in the exif metadata of the RAW files, and the data can be assumer to be completely linear. So for instance:
- the raw image with the color card has an exposure time of 4s
- we compute an exposure shift factor of `1.43` based on the white patch of the color card
- the next image has no color card and an exposure time of 3s
- we assume linearity and apply an exposure shift factor of `(4 / 3) * 1.43 = 1.91` on this image