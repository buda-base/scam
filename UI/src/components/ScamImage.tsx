import React, { FC, MouseEventHandler, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import debugFactory from "debug"
import { encode } from "js-base64"
import { Layer, Stage, Image as KImage, Rect, Transformer } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useInView } from "react-intersection-observer";
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import Konva from "konva";
import { useAtom } from "jotai"
import { useReducerAtom } from "jotai/utils"

import { ConfigData, ScamImageData, KonvaPage, Page, ScamDataState, ScamData } from "../types";
import { apiUrl } from "../App";
import ImageMenu from "./ImageMenu";
import * as state from "../state"

const debug = debugFactory("scam:img")

const scam_options = {
  "alter_checked": false,
  "direction": "vertical",
  "squarishness_min": 0.85,
  "squarishness_min_warn": 0.7,
  "nb_pages_expected": 2,
  "wh_ratio_range": [2.0, 7.0],
  "wh_ratio_range_warn": [1.5, 10],
  "area_ratio_min": 0.2,
  "area_diff_max": 0.15,
  "area_diff_max_warn": 0.7,
  "use_rotation": true,
  "fixed_width": null,
  "fixed_height": null,
  "expand_to_fixed": false,
  "cut_at_fixed": false
}

const padding = 56

const TransformableRect = (props: { shapeProps: KonvaPage, isSelected: boolean, onSelect: () => void, onChange: (p: KonvaPage) => void }) => {
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
        {...{ x: x + padding, y: y + padding, width, height, rotation }}
        {...isSelected ? {} : { stroke: warning ? "orange" : "green" }}
        fill={"rgba(" + (isSelected ? "0,128,255" : warning ? "128,128,0" : "0,255,0") + ",0.1)"}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        //onMouseDown={onSelect}
        onMouseEnter={e => {
          // style stage container:
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "move";
        }}
        onMouseLeave={e => {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "default";
        }}
        onDragEnd={(e) => {
          onChange({
            ...props.shapeProps,
            x: e.target.x() - padding,
            y: e.target.y() - padding,
          });
        }}
        onTransformEnd={(e) => {
          const node = shRef.current;
          if (node) {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onChange({
              ...props.shapeProps,
              x: node.x() - padding,
              y: node.y() - padding,
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


export const ScamImageContainer = (props: { folder: string, image: ScamImageData, config: ConfigData, draft: ScamImageData, loadDraft: boolean|undefined }) => {
  const { image } = props;

  const { ref, inView } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px'
  });

  
  if (inView) {    
    //debug("scanImageContainer:", image.thumbnail_path, JSON.stringify(props, null, 3))
    return <ScamImage {...props} divRef={ref} />
  }
  else {    
    return (
      <div ref={ref} className="scam-image not-visible"
        style={{ height: image.thumbnail_info.height + 2 * padding }}
      >
        <figure>
          <figcaption>{image.img_path}</figcaption>
        </figure>
      </div>
    )
  }
}

let unmount = false

const ScamImage = (props: { folder: string, image: ScamImageData, config: ConfigData, divRef: any, draft: ScamImageData, loadDraft: boolean | undefined }) => {
  const { folder, config, image, divRef, draft, loadDraft } = props;

  const [shouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const savedData = allScamData[image.thumbnail_path]

  const [modified, setModified] = useAtom(state.modified)

  const [scamData, setScamData] = useState<ScamImageData | boolean>(savedData?.time <= shouldRunAfter ? savedData.data : false)
  const [lastRun, setLastRun] = useState(savedData?.time <= shouldRunAfter ? savedData.time : 0)

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)

  const [showDebug, setShowDebug] = useState(true)
  const [selectedId, selectShape] = useState<number | null>(null);

  const [orient, setOrient] = useAtom(state.orientAtom)
  const [direc, setDirec] = useAtom(state.direcAtom)
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)

  const scamOptions = useMemo(() => ({
    ...scam_options,
    "wh_ratio_range": orient == "custom"
      ? [minRatio, maxRatio]
      : orient == "horizontal"
        ? [2.0, 7.0]
        : [0.15, 0.85], // TODO: check values for vertical mode    
    "wh_ratio_range_warn": [1.5, 10], // TODO: shouldn't it be updated w.r.t wh_ratio_range?
    "nb_pages_expected": orient == "custom" ? nbPages : 2,
    "direction": orient == "custom"
      ? direc
      : orient === 'horizontal'
        ? 'vertical'
        : 'horizontal'
  }), [ orient, direc, minRatio, maxRatio, nbPages ])

  const recomputeCoords = (r: Page, i: number, w: number, h: number, W: number, H: number) => {
    const { minAreaRect: rect } = r
    const n = i
    const width = rect[2] * w / W
    const height = rect[3] * h / H
    const x = rect[0] * w / W - width / 2
    const y = rect[1] * h / H - height / 2
    const rotation = rect[4]
    const warning = r.warnings.length > 0
    return ({ n, x, y, width, height, rotation, warning })
  }

  const handleZindex = (rects: KonvaPage[]) => {
    return [...rects.filter(r => r.n != selectedId)].concat([...rects.filter(r => r.n === selectedId)])
  }

  let controller = new AbortController();   

  useEffect(() => {
    //debug("mount:", image.thumbnail_path, controller.signal.aborted)
    unmount = false
    if(controller.signal.aborted) {
      controller = new AbortController();   
    }

    return () => {
      //debug("unmount:",image.thumbnail_path)
      unmount = true
      controller.abort()
    }
  }, [])

  const loadThumb = useCallback(() => {
    
    if (config.auth && konvaImg != true) {

      setKonvaImg(true)

      const url = apiUrl + "get_thumbnail_bytes?thumbnail_path=" + image.thumbnail_path
      const conf: AxiosRequestConfig = {
        headers: {
          Authorization: "Basic " + encode(config.auth.join(":"))
        },
        responseType: 'blob',
        signal: controller.signal
      };
      axios.get(url, conf)
        .then((response: AxiosResponse) => {
          const img: HTMLImageElement = new Image();
          img.src = URL.createObjectURL(response.data);
          setKonvaImg(img)
        })
        .catch(error => {
          if(error.message != "canceled") console.error(error);
        });
    }
  }, [ config.auth, image.thumbnail_path, konvaImg ])

  const getScamResults = useCallback(() => {
    if (config.auth && scamData != true && lastRun < shouldRunAfter) {

      if(loadDraft === undefined) return
      else if(loadDraft && draft && !scamData) {
        //debug("draft:", draft);
        setScamData(draft)
        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: draft, state: 'draft', time: shouldRunAfter }
          }
        })
        return
      }
 
      setScamData(true)
      setLastRun(Date.now())

      //debug("getScamResults:",image.thumbnail_path)

      axios.post(apiUrl + "run_scam_file", {
        folder_path: folder,
        scam_options: scamOptions,
        file_info: image
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: "Basic " + encode(config.auth.join(":"))
        },
        signal: controller.signal
      })
        .then(response => {
          debug("json", response.data);
          if (response.data) {
            const W = response.data.width
            const H = response.data.height
            const w = response.data.thumbnail_info.width
            const h = response.data.thumbnail_info.height
            response.data.rects = (response.data as ScamImageData).pages?.map((r, i) => recomputeCoords(r, i, w, h, W, H))

            setScamData(response.data)
            dispatch({
              type: 'ADD_DATA',
              payload: {
                id: image.thumbnail_path,
                val: { data: response.data, state: 'new', time: shouldRunAfter }
              }
            })
          }
        })
        .catch(error => {
          if(error.message != "canceled") console.error(error);
        });
    }
  }, [ config.auth, folder, image, scamData, scamOptions, lastRun, shouldRunAfter, loadDraft ])

  
  useEffect(() => {
    loadThumb()
  }, [ image.thumbnail_path ])

  useEffect(() => {
    getScamResults()
  }, [ shouldRunAfter, loadDraft ])

  /*
    useEffect(() => {
      debug("allData:", allScamData)
    }, [allScamData])
  */

  const checkDeselect = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs.image;
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };
  const checkDeselectDiv: MouseEventHandler<HTMLDivElement> = (e) => {
    const clickedOnEmpty = (e.target as HTMLDivElement).nodeName != "CANVAS"
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };

  const onSelect = (i: number) => {
    debug("select!", i);
    selectShape(i);
  }

  const onChange = useCallback((p: KonvaPage) => {
    if (typeof scamData === 'object' && scamData.pages && scamData.pages.length > p.n) {
      const data = { ...scamData }

      const W = scamData?.width
      const H = scamData?.height
      const w = scamData?.thumbnail_info.width
      const h = scamData?.thumbnail_info.height

      if (data.pages) {
        data.pages[p.n].minAreaRect[0] = W * (p.x + p.width / 2) / w
        data.pages[p.n].minAreaRect[1] = H * (p.y + p.height / 2) / h
        data.pages[p.n].minAreaRect[2] = W * p.width / w
        data.pages[p.n].minAreaRect[3] = H * p.height / h
        data.pages[p.n].minAreaRect[4] = p.rotation
        data.rects = handleZindex(data.pages.map((r, i) => recomputeCoords(r, i, w, h, W, H)))

        debug(W, H, w, h, p) //,scamData.pages[p.n].minAreaRect)

        setScamData(data)

        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data, state: 'modified', time: shouldRunAfter }
          }
        })

        setModified(true)
      }
    }
  }, [scamData])


  useEffect(() => {
    if (typeof scamData === 'object' && scamData.rects && scamData.selected != selectedId && selectedId != undefined) {
      // handling z-index the react-konva way (https://konvajs.org/docs/react/zIndex.html)
      const rects = handleZindex(scamData.rects)
      setScamData({ ...scamData, selected: selectedId, rects })
    }
  }, [scamData, selectedId])

  return (<div ref={divRef} className={"scam-image" + (scamData === true ? " loading" : "")}
    style={{ height: image.thumbnail_info.height + 2 * padding }}
    onMouseDown={checkDeselectDiv}
  >
    <figure>
      <Stage
        width={image.thumbnail_info.width + padding * 2}
        height={image.thumbnail_info.height + padding * 2}
        onMouseDown={checkDeselect}
        onTouchStart={checkDeselect}
      >
        <Layer>
          {typeof konvaImg === 'object' && <>
            <KImage
              image={konvaImg}
              width={image.thumbnail_info.width}
              height={image.thumbnail_info.height}
              y={padding}
              x={padding}
            />
            {typeof scamData === 'object' &&
              scamData?.rects?.map((rect, i) => <TransformableRect
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
      <figcaption>{image.img_path}</figcaption>
      {showDebug && typeof scamData === 'object' &&
        <div className="debug">
          {JSON.stringify(scamData?.pages, null, 2)}
        </div>
      }
      <ImageMenu />
    </figure>
  </div>
  );
};
