import React, { FC, useEffect, useState } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";
import LazyLoad from 'react-lazyload';

import { ConfigData, ScamImageData } from "../types";
import { apiUrl } from "../App";




const ScamImage = (props: { image: ScamImageData, config: ConfigData }) => {
  const { config, image } = props;
  
  const [scamRes, setScamRes] = useState<ScamImageData>({} as ScamImageData)


  useEffect(() => {
    setScamRes(
      { "height": 2448, "img_path": "SAM_2503.JPG", "pages": [{ "minAreaRect": [1631.500244140625, 358.49993896484375, 3262.99951171875, 716.9998779296875, 0.0], "warnings": [] }, { "minAreaRect": [1645.3409423828125, 1291.401611328125, 2922.633544921875, 839.261779785156, 0.8116922974586487], "warnings": [] }, { "minAreaRect": [1631.5, 2059.5, 3263.0, 761.0, 0.0], "warnings": [] }], "pickle_path": "sam_pickle_gz/Bruno/Reruk/SAM_2503.JPG_sam_pickle.gz", "rotation": 0, "thumbnail_info": { "height": 512, "rotation": 0, "width": 682 }, "thumbnail_path": "thumbnails/Bruno/Reruk/SAM_2503.JPG.jpg", "width": 3264 }
    )
  }, [])


  return (<div className="scam-image">
    {/* <LazyLoadImage
      src={apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path}
      width={image.thumbnail_info.width}
      height={image.thumbnail_info.height}
      /> */}
    <LazyLoad height={image.thumbnail_info.height + 30} unmountIfInvisible={true} offset={2 * window.innerHeight}>
      <figure>
        <img
        src={apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path}
        width={image.thumbnail_info.width}
        height={image.thumbnail_info.height}
        />
        <figcaption>{image.img_path}</figcaption>
      </figure>
    </LazyLoad>
    </div>
  );
};

export default ScamImage;