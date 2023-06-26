import React, { FC, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";
import LazyLoad from 'react-lazyload';
import debugFactory from "debug"
import { encode } from "js-base64"

import { ConfigData, ScamImageData } from "../types";
import { apiUrl } from "../App";
import Konva, { Layer, Stage, Image as KImage } from "react-konva";
import { useInView } from "react-intersection-observer";
import axios from "axios";

const debug = debugFactory("scam:img")

const scam_options = {
  "alter_checked": false,
  "direction": "vertical",
  "squarishness_min": 0.85,
  "squarishness_min_warn": 0.7,
  "nb_pages_expected": 2,
  "wh_ratio_range": [ 3, 7 ],
  "wh_ratio_range_warn": [ 1.5, 10 ],
  "area_ratio_min": 0.2,
  "area_diff_max": 0.15,
  "area_diff_max_warn": 0.7,
  "use_rotation": true,
  "fixed_width": null,
  "fixed_height": null,
  "expand_to_fixed": false,
  "cut_at_fixed": false
}

const ScamImage = (props: { folder:string, image: ScamImageData, config: ConfigData }) => {
  const { folder, config, image } = props;

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)
  const [scamData, setScamData] = useState<ScamImageData | boolean>(false)
  const { ref, inView } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px',
    onChange(inView) {
      if (inView) {
        if (!konvaImg) {
          setKonvaImg(true)
          const img = new Image();
          img.src = apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path
          img.onload = function () {
            setKonvaImg(img)
          }
        }
        if (!scamData) {
          if (config.auth) {
            setScamData(true)
            axios.post(apiUrl + "run_scam_file", {
              folder_path: folder,
              scam_options: scam_options,
              file_info: image
            }, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: "Basic " + encode(config.auth.join(":"))
              },
            })
              .then(response => {
                debug("json", response.data);
                setScamData(response.data)
              })
              .catch(error => {
                console.error(error);
              });
          }

        }
      } else {
        //console.log('not in view');
      }
    }
  });


  return (<div ref={ref} className="scam-image" style={{ height: image.thumbnail_info.height + 30 }}>
    <figure>
      {/* 
        { inView && <img
            src={apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path}
            width={image.thumbnail_info.width}
            height={image.thumbnail_info.height}
          /> }
        */}

      {inView && <Stage
        width={image.thumbnail_info.width}
        height={image.thumbnail_info.height}
      >
        <Layer>
          { typeof konvaImg === 'object' && 
            <KImage
              image={konvaImg}
              width={image.thumbnail_info.width}
              height={image.thumbnail_info.height}
            /> 
          }
        </Layer> 
      </Stage>
      }
      <figcaption>{image.img_path}</figcaption>
    </figure>
  </div>
  );
};

export default ScamImage;