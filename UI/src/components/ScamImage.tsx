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
import { Warning, WarningAmber } from "@mui/icons-material";

import { ConfigData, ScamImageData, KonvaPage, Page, ScamDataState, ScamData, SavedScamData, ScamOptionsMap } from "../types";
import { apiUrl } from "../App";
import ImageMenu from "./ImageMenu";
import * as state from "../state"

const debug = debugFactory("scam:img")

const scam_options: ScamOptionsMap = {
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

const TransformableRect = (props: { shapeProps: KonvaPage, isSelected: boolean, addNew: boolean, portrait:boolean,
    onSelect: () => void, onChange: (p: KonvaPage) => void }) => {
  const { x, y, width, height, rotation, warning } = props.shapeProps;
  const { isSelected, addNew, portrait, onSelect, onChange } = props

  const shRef = useRef<Konva.Rect>(null)
  const trRef = useRef<Konva.Transformer>(null)


  useEffect(() => {
    if (isSelected && shRef.current) {
      trRef.current?.nodes([shRef.current]);
      trRef.current?.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleX = portrait ? height/2 : width/2
  const handleY = portrait ? width/2 : height/2

  return (
    <>
      <Rect
        ref={shRef}
        {...{ x: x + padding + handleX, y: y + padding + handleY, width, height, rotation, offsetX: handleX, offsetY: handleY }}
        {...isSelected ? {} : { stroke: warning ? "orange" : "green" }}
        fill={"rgba(" + (isSelected ? "0,128,255" : warning ? "128,128,0" : "0,255,0") + ",0.1)"}
        draggable={!addNew}
        onClick={onSelect}
        onTap={onSelect}
        //onMouseDown={onSelect}
        onMouseEnter={e => {
          // style stage container:
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = addNew?"copy":"move";
        }}
        onMouseLeave={e => {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = addNew?"copy":"default";
        }}
        onDragEnd={(e) => {
          onChange({
            ...props.shapeProps,
            x: e.target.x() - padding - handleX,
            y: e.target.y() - padding - handleY,
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
              x: node.x() - padding - handleX * scaleX,
              y: node.y() - padding - handleY * scaleY,
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


export const ScamImageContainer = (props: { folder: string, image: ScamImageData, config: ConfigData, draft: SavedScamData, loadDraft: boolean|undefined, setImageData: (data:ScamImageData) => void }) => {
  const { image } = props;

  const { ref, inView } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px'
  });

  const [visible, setVisible] = useState(true)
  const [checked, setChecked] = useState(false)
  
  if (inView) {    
    //debug("scanImageContainer:", image.thumbnail_path, JSON.stringify(props, null, 3))
    return <ScamImage {...props} divRef={ref} {...{visible, checked, setVisible, setChecked}}/>
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

const ScamImage = (props: { folder: string, image: ScamImageData, config: ConfigData, divRef: any, draft: SavedScamData, visible: boolean, 
    loadDraft: boolean | undefined, checked: boolean,
    setImageData:(data:ScamImageData)=>void, setVisible:(b:boolean) => void, setChecked:(b:boolean) => void }) => {
  const { folder, config, image, divRef, draft, loadDraft, visible, checked, setImageData, setVisible, setChecked } = props;

  const [shouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const globalData = allScamData[image.thumbnail_path]

  const [modified, setModified] = useAtom(state.modified)

  const [scamData, setScamData] = useState<ScamImageData | boolean>(globalData?.time >= shouldRunAfter ? globalData.data : false)
  const [lastRun, setLastRun] = useState(globalData?.time <= shouldRunAfter ? globalData.time : 0)

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    setPortrait([90,270].includes(image.rotation) ? true : false)
  }, [image.rotation])

  const [showDebug, setShowDebug] = useState(true)
  const [selectedId, selectShape] = useState<number | null>(null);
  const [addNew, setAddNew] = useState(false)
  const [newPage, setNewPage] = useState<KonvaPage[]>([]);

  const [warning, setWarning] = useState(false)
  
  const [orient, setOrient] = useAtom(state.orientAtom)
  const [direc, setDirec] = useAtom(state.direcAtom)
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)

  const scamOptions:ScamOptionsMap = useMemo(() => ({
    ...scam_options,

    /*
    "squarishness_min": orient == 'horizontal' ? 0.85 : 1/0.85,
    "area_ratio_min": orient == 'horizontal' ? 0.2 : 1/0.2,
    "area_diff_max": orient == 'horizontal' ? 0.15 : 1/0.15,
    */
   
    "wh_ratio_range": orient == "custom"
      ? [minRatio, maxRatio]
      : orient == "horizontal"
        ? [2.0, 7.0]
        : [0.6, 0.8], // TODO: check values for vertical mode    
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

  const handleZindex = useCallback((rects: KonvaPage[]) => {
    return [...rects.filter(r => r.n != selectedId)].concat([...rects.filter(r => r.n === selectedId)])
  }, [selectedId])

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

  //debug("im:",image.thumbnail_path,lastRun,shouldRunAfter,image,scamData)

  const getScamResults = useCallback(() => {
    const now = Date.now()

    debug("gSR!", loadDraft, draft, globalData)    

    if (!checked && visible && config.auth && scamData != true && (lastRun == 1 || lastRun < shouldRunAfter || typeof scamData === 'object' && image.rotation != scamData.rotation)) {
      
      if(loadDraft === undefined) return
      else if(loadDraft && draft && !scamData) {        
        //debug("draft:", draft);
        setScamData(draft.data)
        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: draft.data, state: 'draft', time: shouldRunAfter, image: draft.image, visible: draft.visible, checked: draft.checked }
          }
        })
        if(visible != draft.visible) setVisible(draft.visible)
        if(checked != draft.checked) setChecked(draft.checked)
        return
      }
 
      setScamData(true)
      setLastRun(now)

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

            let state = 'new'
            if(typeof scamData === "object" && scamData.rotation != image.rotation) state = 'modified'

            setScamData(response.data)
            dispatch({
              type: 'ADD_DATA',
              payload: {
                id: image.thumbnail_path,
                val: { data: response.data, state, time: shouldRunAfter, image, visible, checked }
              }
            })
          }
        })
        .catch(error => {
          if(error.message != "canceled") console.error(error);
        });
    }
  }, [loadDraft, draft, globalData, visible, config.auth, scamData, lastRun, shouldRunAfter, image, folder, scamOptions, controller.signal, dispatch, setVisible, checked])

  
  useEffect(() => {
    loadThumb()
  }, [ image.thumbnail_path ])

  useEffect(() => {
    getScamResults()
  }, [ shouldRunAfter, loadDraft, lastRun ])

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
    //debug("deselec", (e.target as HTMLDivElement).nodeName)
    const clickedOnEmpty = !["CANVAS", "SVG", "PATH", "BUTTON"].includes((e.target as HTMLDivElement).nodeName.toUpperCase())
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };

  const onSelect = (i: number) => {
    debug("select!", i);
    selectShape(i);
  }
  
  const removeId = useCallback((id: number) => {
    if(typeof scamData === 'object' && scamData.pages && scamData.rects) {
      debug("remove:", id, scamData.pages[id])
      
      const newData = { ...scamData }

      const W = scamData?.width
      const H = scamData?.height
      const w = scamData?.thumbnail_info.width
      const h = scamData?.thumbnail_info.height
        
      newData.pages = [...scamData.pages.filter((im,n) => n !== id)]
      newData.rects = handleZindex(newData.pages.map((r, i) => recomputeCoords(r, i, w, h, W, H)))

      setScamData(newData)
      dispatch({
        type: 'ADD_DATA',
        payload: {
          id: image.thumbnail_path,
          val: { data: newData, state: 'modified', time: shouldRunAfter, image, visible, checked }
        }
      })
      setModified(true)
      selectShape(null)
    }
  }, [checked, dispatch, handleZindex, image, scamData, setModified, shouldRunAfter, visible])

  const onChange = useCallback((p: KonvaPage, add?: boolean) => {
    if (typeof scamData === 'object' && scamData.pages) {
      const data = { ...scamData }

      if(scamData.pages.length <= p.n && data.pages) {
        if(!add) return
        data.pages.push({ minAreaRect:[0,0,0,0,0], warnings:[] })
      }

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
            val: { data, state: 'modified', time: shouldRunAfter, image, visible, checked }
          }
        })
        setModified(true)
      }
    }
  }, [checked, dispatch, handleZindex, image, scamData, setModified, shouldRunAfter, visible])

  useEffect(() => {
    if (typeof scamData === 'object' && scamData.rects && scamData.selected != selectedId && selectedId != undefined) {
      // handling z-index the react-konva way (https://konvajs.org/docs/react/zIndex.html)
      const rects = handleZindex(scamData.rects)
      setScamData({ ...scamData, selected: selectedId, rects })
    }
  }, [scamData, selectedId])

  const handleMouseDown = (event:KonvaEventObject<MouseEvent>) => {
    if (typeof scamData !== 'object' || !scamData.pages) return
    if (newPage.length === 0) {
      const stage = event.target.getStage()
      if(!stage) return
      const vect = stage.getPointerPosition() 
      if(!vect) return
      const { x, y } = vect
      setNewPage([{ x, y, width: 0, height: 0, n: scamData.pages?.length, rotation:0, warning:false }]);
      selectShape(scamData.pages?.length)
    }
  };

  const handleMouseUp = (event:KonvaEventObject<MouseEvent>) => {
    if (typeof scamData !== 'object' || !scamData.pages) return
    if (newPage.length === 1) {
      const sx = newPage[0].x;
      const sy = newPage[0].y;
      const stage = event.target.getStage()
      if(!stage) return
      const vect = stage.getPointerPosition() 
      if(!vect) return
      const { x, y } = vect;
      if(x !== sx && y !== sy) { 
        const annotationToAdd = {
          ...newPage[0],
          x: sx - padding,
          y: sy - padding,
          width: x - sx,
          height: y - sy
        };        
        onChange(annotationToAdd, true)
        setAddNew(false)
      } 
      setNewPage([]);
    }
  };

  const handleMouseMove = (event:KonvaEventObject<MouseEvent>) => {
    if (typeof scamData !== 'object' || !scamData.pages) return
    if (newPage.length === 1) {
      const sx = newPage[0].x;
      const sy = newPage[0].y;
      const stage = event.target.getStage()
      if(!stage) return
      const vect = stage.getPointerPosition() 
      if(!vect) return
      const { x, y } = vect;
      setNewPage([{
        ...newPage[0],
        x: sx,
        y: sy,
        width: x - sx,
        height: y - sy,
      }]);
    }
  };

  const rotate = useCallback((angle: number) => {
    const rotation = (image.rotation + angle + 360) % 360    
    setImageData({...image, thumbnail_info:{ ...image.thumbnail_info, rotation }, rotation })    
    setModified(true)
    setLastRun(1)
  }, [ image, shouldRunAfter ])

  const toggleVisible = useCallback(() => {
    dispatch({
      type: 'ADD_DATA',
      payload: {
        id: image.thumbnail_path,
        val: { data: scamData, state: 'modified', time: shouldRunAfter, image, visible: !visible, checked }
      }
    })
    setVisible(!visible)
    setModified(true)
  }, [checked, dispatch, image, scamData, setModified, setVisible, shouldRunAfter, visible])

  const toggleCheck = useCallback(() => {
    dispatch({
      type: 'ADD_DATA',
      payload: {
        id: image.thumbnail_path,
        val: { data: scamData, state: 'modified', time: shouldRunAfter, image, visible, checked: !checked }
      }
    })
    setChecked(!checked)
    setModified(true)
  }, [checked, dispatch, image, scamData, setModified, shouldRunAfter, visible])  
  
  useEffect( () => {
    if(typeof scamData === 'object') { 
      if(scamData?.rects?.length != scamOptions["nb_pages_expected"] || scamData?.rects?.some(r => r.warning)) {
        setWarning(true)
      } else {
        setWarning(false)
      }
    }
  }, [ scamData, scamOptions ])

  const actualW = (portrait ? image.thumbnail_info.height : image.thumbnail_info.width)
  const actualH = (portrait ? image.thumbnail_info.width : image.thumbnail_info.height)

  return (<div ref={divRef} className={"scam-image" + (scamData === true ? " loading" : "") + ( scamData != true && warning && !checked && visible ? " has-warning" : "")}
    style={{ height: visible ? actualH + 2 * padding : 80 }}
    onMouseDown={checkDeselectDiv}
  >
    <figure className={"visible-"+visible} 
        {... !visible ? { style: { width: image.thumbnail_info.width + padding * 2, height: 80 } }:{} }>
      { !visible && typeof konvaImg == "object" && <img src={konvaImg?.src} className={"mini"+((image.rotation + 360) % 360 != 0 ? " rotated": "")} style={{transform: "rotate("+image.rotation+"deg)" }}/> }
      { visible  && <Stage
        width={actualW + padding * 2}
        height={actualH + padding * 2}
        onMouseDown={addNew ? handleMouseDown : checkDeselect}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onTouchStart={checkDeselect}        
      >
        <Layer>
          {typeof konvaImg === 'object' && <>
            <KImage
              image={konvaImg}
              width={image.thumbnail_info.width}
              height={image.thumbnail_info.height}
              //x={padding + ([90,180].includes(image.rotation) ? actualW : 0)}
              //y={padding + ([180,270].includes(image.rotation) ? actualH : 0)}
              x={actualW / 2 + padding}
              y={actualH / 2 + padding}
              rotation={360 - image.rotation}
              offsetX={image.thumbnail_info.width / 2}
              offsetY={image.thumbnail_info.height / 2}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container && addNew) container.style.cursor = "copy";
              }}
              onMouseMove={(e) => {
                const container = e.target.getStage()?.container();
                if (container && !addNew && container.style.cursor != "default") container.style.cursor = "default";
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "default";
              }}
            />
          </>}
          {typeof scamData === 'object' &&
            scamData?.rects?.map((rect, i) => (
              <TransformableRect
                key={i}
                shapeProps={rect}
                isSelected={rect.n === selectedId}
                onSelect={() => onSelect(rect.n)}
                {...{ onChange, addNew, portrait }}
              />)
            )
          }
          { newPage.length > 0 && (
            <Rect
              x={newPage[0].x}
              y={newPage[0].y}
              width={newPage[0].width}
              height={newPage[0].height}
              fill="transparent"
              stroke="black"              
            />
          )}
        </Layer>
      </Stage> }
      <figcaption>{image.img_path}
        { scamData != true && visible && warning && !checked && <Warning sx={{ position: "absolute", color: "orange", marginLeft: "5px" }} /> }
        {/* <WarningAmber sx={{ position: "absolute", opacity:"50%" }} /> */}
      </figcaption>
      {showDebug && visible && typeof scamData === 'object' &&
        <div className="debug">
          <div>
          {JSON.stringify(scamData?.pages, null, 2)}
          </div>
        </div>
      }
      <ImageMenu {...{ selectedId, addNew, visible, checked, removeId, setAddNew, selectShape, rotate, toggleVisible, toggleCheck }}/>
    </figure>
  </div>
  );
};
