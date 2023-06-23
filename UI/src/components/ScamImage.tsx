import React, { FC } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";

const ScamImage = (props: { image: any; }) => {
  const { image } = props;

  return (
    <LazyLoadImage src="youpi"/>
  );
};

export default ScamImage;