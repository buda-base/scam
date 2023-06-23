import React, { FC } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";

import { ConfigData, ScamImageData } from "../types";
import { apiUrl } from "../App";

const ScamImage = (props: { image: ScamImageData, config: ConfigData }) => {
  const { config, image } = props;

  return (
    <LazyLoadImage 
      src={apiUrl + "get_thumbnail_bytes?thumbnail_path="+ image.thumbnail_path}
      width={image.thumbnail_info.width} 
      height={image.thumbnail_info.height}
    />
  );
};

export default ScamImage;