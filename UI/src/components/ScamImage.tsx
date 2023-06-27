import React, { FC, useEffect, useLayoutEffect, useRef, useState } from "react";
import debugFactory from "debug"
import { encode } from "js-base64"
import { Layer, Stage, Image as KImage, Rect } from "react-konva";
import { useInView } from "react-intersection-observer";
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

import { ConfigData, ScamImageData, KonvaPage } from "../types";
import { apiUrl } from "../App";

const debug = debugFactory("scam:img")

const scam_options = {
  "alter_checked": false,
  "direction": "vertical",
  "squarishness_min": 0.85,
  "squarishness_min_warn": 0.7,
  "nb_pages_expected": 2,
  "wh_ratio_range": [ 2.0, 7.0 ],
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

          /* // not working in Firefox
          const img = new Image();
          img.src = apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path
          img.onload = function () {
            setKonvaImg(img)
          }
          */        

          const url = apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path
          const conf: AxiosRequestConfig = {
            headers: { 
              Authorization: "Basic " + encode(config.auth.join(":"))
            },
            responseType: 'blob' 
          };
          axios.get(url, conf)
            .then((response: AxiosResponse) => {
              const img: HTMLImageElement = new Image();
              img.src = URL.createObjectURL(response.data);
              setKonvaImg(img)
            })
            .catch(error => {
              console.error(error);
            });
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
                if(response.data) {
                  const W = response.data.width
                  const H = response.data.height
                  const w = response.data.thumbnail_info.width
                  const h = response.data.thumbnail_info.height
                  response.data.rects = (response.data as ScamImageData).pages?.map(r => {
                    const { minAreaRect: rect } = r
                    const width = rect[2] * w / W
                    const height = rect[3] * h / H
                    const x = rect[0] * w / W - width / 2
                    const y  = rect[1] * h / H - height / 2
                    const rotation = rect[4]
                    const warning = r.warnings.length > 0
                    return ({x, y, width, height, rotation, warning})
                  })
                  setScamData(response.data)
                }
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
      {inView && <Stage
        width={image.thumbnail_info.width}
        height={image.thumbnail_info.height}
      >
        <Layer>
          { typeof konvaImg === 'object' && <>
            <KImage
              image={konvaImg}
              width={image.thumbnail_info.width}
              height={image.thumbnail_info.height}
            /> 
            { typeof scamData === 'object' && 
              scamData?.rects?.map(({ x, y, width, height, rotation, warning }) => (
                <Rect {...{ x, y, width, height }} stroke={warning ? "orange" : "green"} fill={"rgba("+(warning ? "128,128" : "0,255")+",0,0.1)"} {...{ rotation }}/>
              ))
            }
            </>
          }
        </Layer> 
      </Stage>
      }
      <figcaption>{image.img_path}</figcaption>
      { typeof scamData === 'object' && 
        <div className="debug">
        { JSON.stringify(scamData?.pages, null, 2) }
        </div> 
      }
    </figure>
  </div>
  );
};

export default ScamImage;