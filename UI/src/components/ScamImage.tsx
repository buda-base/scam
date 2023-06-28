    import React, { FC, MouseEventHandler, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import debugFactory from "debug"
import { encode } from "js-base64"
import { Layer, Stage, Image as KImage, Rect, Transformer } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useInView } from "react-intersection-observer";
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import Konva from "konva";

import { ConfigData, ScamImageData, KonvaPage, Page } from "../types";
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

const TransformableRect = (props: { shapeProps: KonvaPage, isSelected: boolean, onSelect: () => void, onChange: (p: KonvaPage) => void } ) => {
  const { x, y, width, height, rotation, warning } = props.shapeProps;
  const { isSelected, onSelect, onChange } = props

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
      //onMouseDown={onSelect}
      onDragEnd={(e) => {
        onChange({
          ...props.shapeProps,
          x: e.target.x(),
          y: e.target.y(),
        });
      }}
      onTransformEnd={(e) => {
        const node = shRef.current;
        if(node) {
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...props.shapeProps,
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            // set minimal value
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
          });
        }
      }}
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

  const recomputeCoords = (r: Page, i: number,w: number,h: number,W: number,H: number) => {
    const { minAreaRect: rect } = r
    const n = i
    const width = rect[2] * w / W
    const height = rect[3] * h / H
    const x = rect[0] * w / W - width / 2
    const y  = rect[1] * h / H - height / 2
    const rotation = rect[4]
    const warning = r.warnings.length > 0
    return ({n, x, y, width, height, rotation, warning})
  }

  const handleZindex = (rects: KonvaPage[]) => {
    return [ ...rects.filter(r => r.n != selectedId) ].concat([ ...rects.filter(r => r.n === selectedId) ])
  }

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)
  const [scamData, setScamData] = useState<ScamImageData | boolean>(false)
  const { ref, inView } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px',
    onChange(inView) {
      if (inView) {
        if (!konvaImg) {

          setKonvaImg(true)

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
                  response.data.rects = (response.data as ScamImageData).pages?.map((r,i) => recomputeCoords(r, i, w, h, W, H))
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

  const onSelect = (i:number) => {
    debug("select!",i); 
    selectShape(i); 
  }

  const onChange = useCallback((p:KonvaPage) => {
    if( typeof scamData === 'object' && scamData.pages && scamData.pages.length > p.n) {
      const data = { ...scamData }

      const W = scamData?.width
      const H = scamData?.height
      const w = scamData?.thumbnail_info.width
      const h = scamData?.thumbnail_info.height

      if(data.pages) {
        data.pages[p.n].minAreaRect[0] =  W * (p.x + p.width / 2) / w
        data.pages[p.n].minAreaRect[1] =  H * (p.y + p.height / 2) / h
        data.pages[p.n].minAreaRect[2] =  W * p.width / w
        data.pages[p.n].minAreaRect[3] =  H * p.height / h
        data.pages[p.n].minAreaRect[4] =  p.rotation
        data.rects = handleZindex(data.pages.map((r,i) => recomputeCoords(r, i, w, h, W, H)))        
  
        debug(W,H,w,h,p) //,scamData.pages[p.n].minAreaRect)
        
        setScamData(data)
      }
    }
  }, [scamData])
  

  useEffect(()=> {
    if( typeof scamData === 'object' && scamData.rects && scamData.selected != selectedId && selectedId != undefined) {
      // handling z-index the react-konva way (https://konvajs.org/docs/react/zIndex.html)
      const rects = handleZindex(scamData.rects)
      setScamData({ ...scamData, selected: selectedId, rects })  
    }
  }, [scamData, selectedId])

  return (<div ref={ref} className="scam-image" 
      style={{ height: image.thumbnail_info.height + 30 }}
      onMouseDown={checkDeselectDiv}
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
                  {...{ onChange }}
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