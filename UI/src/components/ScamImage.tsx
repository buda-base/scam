    import React, { FC, MouseEventHandler, useEffect, useLayoutEffect, useRef, useState } from "react";
import debugFactory from "debug"
import { encode } from "js-base64"
import { Layer, Stage, Image as KImage, Rect, Transformer } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useInView } from "react-intersection-observer";
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import Konva from "konva";

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

const TransformableRect = (props: { shapeProps: KonvaPage, isSelected: boolean, onSelect: () => void } ) => {
  const { x, y, width, height, rotation, warning } = props.shapeProps;
  const { isSelected, onSelect } = props

  const shRef = useRef<Konva.Rect>(null)
  const trRef = useRef<Konva.Transformer>(null)


  useEffect(() => {
    if (isSelected && shRef.current) {
      trRef.current?.nodes([shRef.current]);
      trRef.current?.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  return (
    <>
    <Rect 
      ref={shRef}
      {...{ x, y, width, height, rotation }}         
      {...isSelected?{}:{stroke:warning ? "orange" : "green"}} 
      fill={"rgba("+(isSelected ? "0,128,255" : warning ? "128,128,0" : "0,255,0")+",0.1)"} 
      draggable 
      onClick={onSelect}
      onTap={onSelect}

    />

    {isSelected && (
      <Transformer
        ref={trRef}
        boundBoxFunc={(oldBox, newBox) => {
            // limit resize
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
      />
      )}
    </>
  )
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
                  response.data.rects = (response.data as ScamImageData).pages?.map((r,i) => {
                    const { minAreaRect: rect } = r
                    const n = i
                    const width = rect[2] * w / W
                    const height = rect[3] * h / H
                    const x = rect[0] * w / W - width / 2
                    const y  = rect[1] * h / H - height / 2
                    const rotation = rect[4]
                    const warning = r.warnings.length > 0
                    return ({n, x, y, width, height, rotation, warning})
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
  const [selectedId, selectShape] = useState<number | null>(null);
  const checkDeselect = (e: KonvaEventObject<MouseEvent|TouchEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs.image;
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };
  const checkDeselectDiv:MouseEventHandler<HTMLDivElement> = (e) => {
    const clickedOnEmpty = (e.target as HTMLDivElement).nodeName != "CANVAS"
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };
  const onSelect= (i:number) => {
    debug("select!",i); 
    selectShape(i); 
  }
  
  useEffect(()=> {
    if( typeof scamData === 'object' && scamData.rects ) {
      // handling z-index the react-konva way (https://konvajs.org/docs/react/zIndex.html)
      const rects = [ ...scamData.rects.filter(r => r.n != selectedId) ].concat([ ...scamData.rects.filter(r => r.n === selectedId) ])
      setScamData({ ...scamData, rects })  
    }
  }, [scamData, selectedId])

  return (<div ref={ref} className="scam-image" 
      style={{ height: image.thumbnail_info.height + 30 }}
      onClick={checkDeselectDiv}
    >
    <figure>
      {inView && <Stage
        width={image.thumbnail_info.width}
        height={image.thumbnail_info.height}
        onMouseDown={checkDeselect}
        onTouchStart={checkDeselect}
      >
        <Layer>
          { typeof konvaImg === 'object' && <>
            <KImage
              image={konvaImg}
              width={image.thumbnail_info.width}
              height={image.thumbnail_info.height}
            /> 
            { typeof scamData === 'object' && 
              scamData?.rects?.map((rect,i) => <TransformableRect 
                  key={i}
                  shapeProps={rect}
                  isSelected={rect.n === selectedId}
                  onSelect={() => onSelect(rect.n)}
                  /*
                  onChange={(newAttrs) => {
                    const rects = rectangles.slice();
                    rects[i] = newAttrs;
                    setRectangles(rects);
                  }}
                  */
              />)
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