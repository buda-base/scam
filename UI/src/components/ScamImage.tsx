import React, { FC, MouseEventHandler, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import debugFactory from "debug"
import { encode } from "js-base64"
import { Layer, Stage, Image as KImage, Rect, Transformer, Text } from "react-konva";
import { KonvaEventObject } from "konva/lib/Node";
import { useInView } from "react-intersection-observer";
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import Konva from "konva";
import { useAtom } from "jotai"
import { useReducerAtom } from "jotai/utils"
import { ErrorOutline, Warning, WarningAmber } from "@mui/icons-material";
import { Checkbox, FormControlLabel } from "@mui/material";
import _ from "lodash";

import { ConfigData, ScamImageData, KonvaPage, Page, ScamDataState, ScamData, SavedScamData, ScamOptionsMap } from "../types";
import { apiUrl, scam_options } from "../App";
import ImageMenu from "./ImageMenu";
import * as state from "../state"

const debug = debugFactory("scam:img")

const padding = 56

const TransformableRect = (props: { shapeProps: KonvaPage, isSelected: boolean, addNew: boolean, portrait:boolean, page?: Page,
    onSelect: () => void, onChange: (p: KonvaPage) => void }) => {
  const { x, y, width, height, rotation, warning, rotatedHandle } = props.shapeProps;
  const { isSelected, addNew, portrait, page, onSelect, onChange } = props

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

  const ratio = useMemo(() => 
    Math.round(1000*(rotatedHandle?height/width:width/height)) / 1000, 
    [rotatedHandle, width, height]
  )

  const [selectedRatio, setSelectedRatio ] = useAtom(state.selectedRatio) 
  const [selectedAreaRatio, setSelectedAreaRatio ] = useAtom(state.selectedAreaRatio) 
  const [selectedCutAtFixed, setSelectedCutAtFixed ] = useAtom(state.selectedCutAtFixed) 
  useEffect(() => {
    if(isSelected && shRef.current) {
      const stage = shRef.current.getStage()
      if(stage) {
        const W = stage.attrs.width - 2 * padding, H = stage.attrs.height - 2 * padding, 
          w = shRef.current.attrs.width, h = shRef.current.attrs.height, 
          areaRatio = Math.round(1000 * (w * h) / (W * H)) / 1000
        setSelectedRatio(ratio)
        setSelectedAreaRatio(areaRatio)

        if(rotatedHandle) setSelectedCutAtFixed([page?.minAreaRect[3] || 0, page?.minAreaRect[2] || 0])
        else setSelectedCutAtFixed([page?.minAreaRect[2] || 0, page?.minAreaRect[3] || 0])
      }
    }
  }, [isSelected, ratio, rotatedHandle])

  
  const res = useMemo(() => (rotatedHandle 
    ? Math.round(page?.minAreaRect[3] || 0) + " x " + Math.round(page?.minAreaRect[2] || 0)
    : Math.round(page?.minAreaRect[2] || 0) + " x " + Math.round(page?.minAreaRect[3] || 0)
  ), [page, rotatedHandle])

  return (
    <>
      { isSelected && <Text fill="black" stroke='white' strokeWidth={2} fillAfterStrokeEnabled={true}
          text={res} verticalAlign='middle' align='center' width={150} height={30} fontSize={15}
          {...{ x: x + (portrait ? handleY : handleX) - 75 + padding, y: y + (portrait ? handleX : handleY) - 15 - 15 + padding }} 
        /> }
      { isSelected && <Text fill="black" stroke='white' strokeWidth={2} fillAfterStrokeEnabled={true}
          text={"ratio="+ratio+""} verticalAlign='middle' align='center' width={150} height={30} fontSize={15}
          {...{ x: x + (portrait ? handleY : handleX) - 75 + padding, y: y + (portrait ? handleX : handleY) - 0 - 15 + padding }} 
        /> }
      { isSelected && <Text fill="black" stroke='white' strokeWidth={2} fillAfterStrokeEnabled={true}
        text={"area ratio="+selectedAreaRatio+""} verticalAlign='middle' align='center' width={200} height={30} fontSize={15}
        {...{ x: x + (portrait ? handleY : handleX) - 100 + padding, y: y + (portrait ? handleX : handleY) + 15 - 15 + padding}} 
      /> }
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
          onSelect()
        }}
        onTransformEnd={() => {
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
              ...warning?{warning:false}:{}
            });
          }
        }}
        dragBoundFunc={(p) => {
          // DONE: keep box inside image                    
          let stage:any = shRef.current
          while(stage?.parent) stage = stage.parent ;
          const b = shRef.current?.getClientRect()                    
          if(b && !portrait) {
            if(p.x <= padding + b.width / 2) {
              p.x = padding + b.width / 2
            }
            if(p.y <= padding + b.height / 2) {            
              p.y = padding + b.height / 2 
            }
            if(p.x >= stage.attrs.width - padding - b.width / 2) {
              p.x = stage.attrs.width - padding - b.width / 2
            }
            if(p.y >= stage.attrs.height - padding - b.height / 2) {            
              p.y = stage.attrs.height - padding - b.height / 2 
            }          
          }
          return p
        }}
      />      

      {isSelected && (
        <Transformer
          keepRatio={false}
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {                        
            // limit resize
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }

            // WIP: keep box inside image
            let stage:any = shRef.current
            while(stage?.parent) stage = stage.parent ;
            const b = shRef.current?.getClientRect()   
            const a = Math.abs(oldBox.rotation * 180 / Math.PI) 
            //debug("\n",b, oldBox, newBox, a)                        
            if(newBox.rotation == oldBox.rotation) {
              // non-rotated portrait box
              if(a <= 5) {
                if(newBox.x <= padding) {
                  if(oldBox.x != newBox.x) newBox.width = oldBox.width + (oldBox.x - padding)
                  newBox.x = padding                 
                }
                if(newBox.y <= padding) {
                  if(oldBox.y != newBox.y) newBox.height = oldBox.height + (oldBox.y - padding)
                  newBox.y = padding
                }                
                if(newBox.x + newBox.width >= stage.attrs.width - padding) {
                  newBox.width = stage.attrs.width - padding - newBox.x 
                } 
                if(newBox.y + newBox.height >= stage.attrs.height - padding) {
                  newBox.height = stage.attrs.height - padding - newBox.y 
                } 
                return newBox
              }
              // non-rotated landscape box
              else if(a >= 85 && a <= 95) {
                if(newBox.x >= stage.attrs.width - padding) {
                  if(oldBox.x != newBox.x) newBox.height = oldBox.height + ((stage.attrs.width - padding) - oldBox.x)
                  newBox.x = stage.attrs.width - padding
                }
                if(newBox.y <= padding) {
                  if(oldBox.y != newBox.y) newBox.width = oldBox.width + (oldBox.y - padding)
                  newBox.y = padding
                }   
                if(newBox.x - newBox.height <= padding) {
                  newBox.height = newBox.x - padding
                }
                if(newBox.y + newBox.width >= stage.attrs.height - padding) {
                  newBox.width = stage.attrs.height - padding - newBox.y 
                } 
                return newBox
              } 
            }
            // TODO: other cases?
            return newBox;
          }}
        />
      )}
    </>
  )
}


export const ScamImageContainer = (props: { folder: string, image: ScamImageData, config: ConfigData, draft: SavedScamData, loadDraft: boolean|undefined, selected:boolean,
    setImageData: (data:ScamImageData|ScamImageData[]) => void, handleSelectItem: (ev:React.SyntheticEvent, v:boolean, s:string) => void }) => {
  const { image, selected, handleSelectItem } = props;

  const { ref, inView, entry } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px'
  });

  const [visible, setVisible] = useState(image.hidden ? false : true)
  const [checked, setChecked] = useState(image.checked ? true : false)
  
  useEffect(()=>{
    setVisible(image.hidden ? false : true)
  }, [image.hidden])

  useEffect(()=>{
    setChecked(image.checked ?  true : false)
  }, [image.checked])

  const figureRef = useRef<HTMLElement>(null)
  
  const [grid, setGrid] = useAtom(state.grid)  

  if (inView) { 
    
    return <ScamImage {...props} divRef={ref} {...{visible, checked, selected, setVisible, setChecked, handleSelectItem}}/>
  }
  else {    

    const w = (figureRef.current?.parentElement?.offsetWidth || 0) - 2 * padding
    const h = w * image.thumbnail_info.height / image.thumbnail_info.width

    return (
      <div ref={ref} className={"scam-image not-visible" + (" grid-" + grid)}
        style={{ height: h + 2 * padding, maxWidth: image.thumbnail_info.width + 2*padding }}
      >
        <figure ref={figureRef} style={{ display: "block" }}>
          <figcaption>{image.img_path}</figcaption>
          {/* 
          // good idea but slows scrolling a lot..
          <figcaption>
            <FormControlLabel label={image.img_path} control={<Checkbox checked={selected} sx={{padding: "0 8px" }}/>}  /> 
          </figcaption> 
          */}
        </figure>
      </div>
    )
  }
}

let unmount = false


export const recomputeCoords = (r: Page, i: number, w: number, h: number, W: number, H: number) => {
  const { minAreaRect: rect, rotatedHandle } = r
  const n = i
  const width = rect[2] * w / W
  const height = rect[3] * h / H
  const x = rect[0] * w / W - width / 2
  const y = rect[1] * h / H - height / 2
  const rotation = rect[4]
  const warning = r.warnings.length > 0
  return ({ n, x, y, width, height, rotation, warning, rotatedHandle })
}

export const withRotatedHandle = (r: Page, data: ScamImageData) => {    
  const { minAreaRect: rect } = r  
  let width = rect[2] 
  let height = rect[3] 
  let rotation = rect[4]
  let rotatedHandle = r.rotatedHandle
  if(width > height 
      // TODO: inverting w & h to keep rotation handle on the small side doesn't work for portrait A4 with 90/270 rotation...
      && ![90,270].includes(data.rotation) 
    ) { 
    width = rect[3] 
    height = rect[2]
    if(!rotatedHandle) rotation = (rotation + 90) % 360 
    else rotation = (rotation - 90) % 360 
    rotatedHandle = !rotatedHandle        
  }
  return ({ ...r, minAreaRect: [ rect[0], rect[1], width, height, rotation ], rotatedHandle })
}

export const withoutRotatedHandle = (r: Page) => {
  const { minAreaRect: rect, warnings } = r
  let width = rect[2] 
  let height = rect[3] 
  let rotation = rect[4]
  if(r.rotatedHandle) {
    width = rect[3] 
    height = rect[2]
    rotation = (rotation - 90) % 360 
  }
  return ({ warnings, minAreaRect: [ rect[0], rect[1], width, height, rotation ] })
}


// Hook
function useWindowSize() {
  const [windowSize, setWindowSize] = useState({
    width: 0,
    height: 0,
  });
  useEffect(() => {
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []); 
  return windowSize;
}

const ScamImage = (props: { folder: string, image: ScamImageData, config: ConfigData, divRef: any, draft: SavedScamData, visible: boolean, 
    loadDraft: boolean | undefined, checked: boolean, selected:boolean,
    setImageData:(data:ScamImageData|ScamImageData[])=>void, setVisible:(b:boolean) => void, setChecked:(b:boolean) => void, handleSelectItem: (ev:React.SyntheticEvent, v:boolean, s:string) => void }) => {
  const { folder, config, image, divRef, draft, loadDraft, visible, checked, selected, setImageData, setVisible, setChecked, handleSelectItem } = props;

  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const windowSize = useWindowSize();

  const [filter, setFilter] = useAtom(state.filter)
  const [grid, setGrid] = useAtom(state.grid)  

  const [dimensions, setDimensions] = useState({
    width: 0,
    height: image.thumbnail_info.height
  })
  const figureRef = useRef<HTMLElement>(null)

  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    setPortrait([90,270].includes(image.rotation) ? true : false)
  }, [image.rotation])

  useEffect(() => {    
    if (figureRef.current?.parentElement) { 
      let w = Math.max(300, (figureRef.current?.parentElement?.offsetWidth || 0) - 2 * padding)
      let h = w * image.height / image.width 
      if(portrait) {
        if(w > h) {
          h = Math.max(300, h)
        } else if(h > w) { 
          h = w
        }
        w = h * image.width / image.height
      }
      if(w != dimensions.width || h != dimensions.height) {
        setDimensions({
          width: w,
          height: h
        })
      }
    }    
  }, [grid, figureRef, dimensions, image, windowSize, portrait])


  let tmpPages ;
  const uploadedData = image?.pages ? { 
      ...image, 
      pages: (tmpPages = image.pages.map((p) => withRotatedHandle(p, image)) as Page[]),
      rects: tmpPages.map((r, i) => recomputeCoords(r, i, dimensions.width, dimensions.height, image.width, image.height))
    } : null

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const globalData = allScamData[image.thumbnail_path]


  const [published, setPublished] = useState(false)
  const [modified, setModified] = useAtom(state.modified)
  const [drafted, setDrafted] = useAtom(state.drafted)

  const [scamData, setScamData] = useState<ScamImageData | boolean>((!draft || loadDraft == false) && globalData?.state != "modified" && uploadedData 
                                                                  || globalData?.data || false ) //(globalData?.time >= shouldRunAfter ? globalData.data : false))
  const [lastRun, setLastRun] = useState(globalData?.time <= shouldRunAfter ? globalData.time : 0)  

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)

  const [showDebug, setShowDebug] = useState(false)
  const [selectedId, selectShape] = useState<number | null>(null);
  const [addNew, setAddNew] = useState(false)
  const [newPage, setNewPage] = useState<KonvaPage[]>([]);

  const [warning, setWarning] = useState(false)
  
  const [configReady, setConfigReady] = useAtom(state.configReady)
  
  const [keyDown, setKeyDown] = useAtom(state.keyDown)
  const [focused, setFocused] = useAtom(state.focused)

  const [deselectAll, setDeselectAll] = useAtom(state.deselectAll)
  
  const [restrictRun, setRestrictRun] = useAtom(state.restrictRun)

  const [orient, setOrient] = useAtom(state.orientAtom) 
  const [direc, setDirec] = useAtom(state.direcAtom) 
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)
  const [minAreaRatio, setMinAreaRatio] = useAtom(state.minAreaRatioAtom)
  const [maxAreaRatio, setMaxAreaRatio] = useAtom(state.maxAreaRatioAtom)
  const [minSquarish, setMinSquarish] = useAtom(state.minSquarishAtom)
  const [fixedWidth, setFixedWidth] = useAtom(state.fixedWidthAtom)
  const [fixedHeight, setFixedHeight] = useAtom(state.fixedHeightAtom)
  const [cutAtFixed, setCutAtFixed] = useAtom(state.cutAtFixedAtom)
  
  const [scamOptions, setScamOptions] = useAtom(state.scamOptions)
  const [scamOptionsSelected, setScamOptionsSelected] = useAtom(state.scamOptionsSelected)
  
  const [configs, setConfigs] = useAtom(state.configs)
  
  const [selectedRatio, setSelectedRatio ] = useAtom(state.selectedRatio) 
  const [selectedAreaRatio, setSelectedAreaRatio ] = useAtom(state.selectedAreaRatio) 
  const [selectedCutAtFixed, setSelectedCutAtFixed ] = useAtom(state.selectedCutAtFixed) 

  useEffect(() => {
    //debug("des:", image.thumbnail_path, deselectAll)
    if(deselectAll) selectShape(null)
  }, [deselectAll])

  useEffect(() => {
    if(selectedId != null && deselectAll) setDeselectAll(false)
  }, [selectedId, deselectAll])

  const handleZindex = useCallback((rects: KonvaPage[]) => {
    return [...rects.filter(r => r.n != selectedId)].concat([...rects.filter(r => r.n === selectedId)])
  }, [selectedId])

  const updateRects = useCallback( () => {
    if(typeof scamData === 'object' && scamData.pages && scamData.rects) {

      //debug("resize!", dimensions, image.thumbnail_path)
      
      const newData = { ...scamData }

      const W = scamData?.width
      const H = scamData?.height
      const w = dimensions.width
      const h = dimensions.height
        
      newData.pages = [...scamData.pages]
      newData.rects = handleZindex(newData.pages.map((r, i) => recomputeCoords(r, i, w, h, W, H)))            

      setScamData(newData)
      dispatch({
        type: 'UPDATE_DATA',
        payload: {
          id: image.thumbnail_path,
          val: { data: newData }
        }
      })
    }
  }, [dimensions, dispatch, handleZindex, image, scamData])
    
  const [resized, setResized] = useState("")
  useEffect(() => {
    if(windowSize.width + "-" + windowSize.height != resized && typeof scamData === 'object' && scamData.pages && scamData.rects) {
      setResized(windowSize.width + "-" + windowSize.height) 
      updateRects()
    } 
  }, [windowSize, updateRects, resized, scamData])

  useEffect(() => {
    //debug("dimensions:", image.thumbnail_path, dimensions)
    setResized("")
  }, [dimensions, folder])

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
  }, [config.auth, controller.signal, image.thumbnail_path, konvaImg])

  //debug("im:",image.thumbnail_path,lastRun,shouldRunAfter,image,scamData)

  const [scamQueue, setScamQueue] = useAtom(state.scamQueue)  

  const reloadData = useCallback(() => {
    //debug("rD?",lastRun,image.thumbnail_path)
    if(globalData && globalData.data) {  //&& globalData?.time != lastRun) { 
      //debug("gD!",lastRun,image.thumbnail_path,globalData?.time,scamQueue,globalData.data.pages,globalData.data.rects)
      
      const newData = { 
        ...globalData.data,
        rects: globalData.data.pages?.map((r, i) => recomputeCoords(r, i, dimensions.width, dimensions.height, globalData.data.width, globalData.data.height))
      }
      setScamData(newData)
      setLastRun(globalData.time)
    }
  }, [dimensions, globalData, image, lastRun, scamQueue])

  useEffect(() => {
    reloadData()
  }, [globalData])

  const getScamResults = useCallback(() => {
    const now = Date.now()

    //debug("gSR!", image?.thumbnail_path, shouldRunAfter, restrictRun, selected, configReady, scamOptions, loadDraft, draft, globalData, typeof scamData === 'object' && scamData.pages)    

    if ((!restrictRun || selected) && configReady != false && visible && config.auth && scamData != true && (lastRun == 1 || lastRun < shouldRunAfter || typeof scamData === 'object' && image.rotation != scamData.rotation)) {
      
      if(loadDraft === undefined) return
      else if(loadDraft && draft && !scamData) {        
        
        //debug("draft:", draft);

        const newData = {
          ...draft.data,
          rects: draft.data.pages?.map((r, i) => recomputeCoords(r, i, dimensions.width, dimensions.height, draft.data.width, draft.data.height))
        }
        setScamData(newData)
        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: newData, state: 'draft', time: shouldRunAfter, image: draft.image, visible: draft.visible, checked: draft.checked, options: draft.options }
          }
        })
        if(visible != draft.visible) setVisible(draft.visible)
        if(checked != draft.checked) setChecked(draft.checked)
        return

      } else if(uploadedData && (!globalData || globalData.state === "uploaded")) {

        //debug("previously uploaded data:", image.thumbnail_path, uploadedData)

        let options
        if(uploadedData.options_index != undefined) {
          options = configs[uploadedData.options_index]
        }

        setScamData(uploadedData)
        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: { ...uploadedData }, state: 'uploaded', time: shouldRunAfter, image: image, visible, checked, options }
          }
        })
        return
      }

      if(checked) return 

      
      //debug("getScamResults:",image.thumbnail_path)
      
      /* // lets move this elsewhere...
      
      setScamData(true)

      setLastRun(now)

      const opts= {
        ...scam_options,  
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
            : 'horizontal',
        "area_ratio_range": orient == "custom"
          ? [minAreaRatio, maxAreaRatio]
          : [0.2, 0.9],
        "squarishness_min": orient == "custom" 
          ? minSquarish
          : 0.85,
        "cut_at_fixed": orient == "custom" 
          ? cutAtFixed
          : false,
        "fixed_width": orient == "custom" 
          ? fixedWidth
          : -1,
        "fixed_height": orient == "custom" 
          ? fixedHeight
          : -1,
      }
      

      axios.post(apiUrl + "run_scam_file", {
        folder_path: folder,
        scam_options: opts,
        file_info: image
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: "Basic " + encode(config.auth.join(":"))
        },
        signal: controller.signal
      })
        .then(response => {
          //debug("json:", response.data);
          if (response.data) {
            const W = response.data.width
            const H = response.data.height
            const w = dimensions.width
            const h = dimensions.height
            const d = response.data as ScamImageData
            response.data.pages = d.pages?.map(p => withRotatedHandle(p, d))
            response.data.rects = d.pages?.map((r, i) => recomputeCoords(r, i, w, h, W, H))

            let state = 'new'
            if(typeof scamData === "object" && scamData.rotation != image.rotation) state = 'modified'
            if(restrictRun) state = 'modified'

            setScamData(response.data)
            dispatch({
              type: 'ADD_DATA',
              payload: {
                id: image.thumbnail_path,
                val: { data: response.data, state, time: shouldRunAfter, image, visible, checked, options: selected ? { ...scamOptionsSelected}:{...scamOptions} } 
              }
            })
           
            // #9 always ungray save buttons after run_
            //if(state === "modified") {
              if(!modified) setModified(true)
              if(drafted) setDrafted(false)
              if(published) setPublished(false)
            //}
            
          }
        })
        .catch(error => {
          if(error.message != "canceled") console.error(error);
        });

      */
    }
  }, [uploadedData, configs, restrictRun, selected, configReady, visible, config, scamData, lastRun, shouldRunAfter, image, loadDraft, draft, globalData, checked, dispatch, setVisible, setChecked, dimensions])

  
  useEffect(() => {
    loadThumb()
  }, [ image.thumbnail_path ])

  useEffect(() => {
    getScamResults()
  }, [ shouldRunAfter, loadDraft, lastRun, configReady ])

  /*
    useEffect(() => {
      debug("allData:", allScamData)
    }, [allScamData])
  */

  const checkDeselect = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    //debug("deselec:", e.target.nodeType, e.target.attrs.image)
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs.image;
    if (clickedOnEmpty) {
      selectShape(null);
      setSelectedRatio(0);
      setSelectedAreaRatio(0);
      setSelectedCutAtFixed([]);
    }
  };
  const checkDeselectDiv: MouseEventHandler<HTMLDivElement> = (e) => {
    //debug("deselec div:", (e.target as HTMLDivElement).nodeName)
    const clickedOnEmpty = !["CANVAS", "SVG", "PATH", "BUTTON"].includes((e.target as HTMLDivElement).nodeName.toUpperCase())
    if (clickedOnEmpty) {
      selectShape(null);
      setSelectedRatio(0);
      setSelectedAreaRatio(0);
      setSelectedCutAtFixed([]);
    }
  };

  const onSelect = (i: number) => {
    //debug("select!", i);
    selectShape(i);
  }
  
  const removeId = useCallback((id: number) => {
    if(typeof scamData === 'object' && scamData.pages && scamData.rects) {
      debug("remove:", id, scamData.pages[id])
      
      const newData = { ...scamData }

      const W = scamData?.width
      const H = scamData?.height
      const w = dimensions.width
      const h = dimensions.height
        
      newData.pages = [...scamData.pages.filter((_im,n) => n !== id)]
      newData.rects = handleZindex(newData.pages.map((r, i) => recomputeCoords(r, i, w, h, W, H)))

      setScamData(newData)
      dispatch({
        type: 'UPDATE_DATA',
        payload: {
          id: image.thumbnail_path,
          val: { data: newData, state: 'modified', time: shouldRunAfter, checked:true }
        }
      })        
      if(modified) setDrafted(false) 
      setModified(true)
      selectShape(newData.pages.length ? newData.pages.length - 1 : null)
      if(!checked) setChecked(true)
    }
  }, [checked, dimensions, modified, dispatch, handleZindex, image, scamData, setModified, shouldRunAfter, visible])

  useEffect(() => {
    if(focused != image.thumbnail_path) {
      selectShape(null)
    }
  }, [focused, image.thumbnail_path])

  const [clipboard, setClipboard] = useAtom(state.clipboard)

  const onChange = useCallback((p: KonvaPage, add?: boolean) => {
    
    let data:ScamImageData 
    if (typeof scamData !== 'object') {
      data = { ...image, pages:[] }
    } else {
      data = { ...scamData }
    }

    debug("ch:", p, data)

    if(!data.pages) data.pages = []

    if(data.pages.length <= p.n && data.pages) {
      if(!add) return
      data.pages.push({ minAreaRect:[0,0,0,0,0], warnings:[] })
    }

    const W = data?.width
    const H = data?.height
    const w = dimensions.width
    const h = dimensions.height

    if (data.pages) {
              
      if(p.warning === false && data.pages[p.n].warnings.length) {
        data.pages[p.n].warnings = []
      }

      data.pages[p.n].minAreaRect[0] = W * (p.x + p.width / 2) / w
      data.pages[p.n].minAreaRect[1] = H * (p.y + p.height / 2) / h
      data.pages[p.n].minAreaRect[2] = W * p.width / w
      data.pages[p.n].minAreaRect[3] = H * p.height / h
      data.pages[p.n].minAreaRect[4] = p.rotation
      data.pages = data.pages.map(p => withRotatedHandle(p, data)) as Page[]
      data.rects = handleZindex(data.pages.map((r, i) => recomputeCoords(r, i, w, h, W, H)))

      debug(W, H, w, h, p) //,scamData.pages[p.n].minAreaRect)

      setScamData(data)
      dispatch({
        type: 'UPDATE_DATA',
        payload: {
          id: image.thumbnail_path,
          val: { data, state: 'modified', time: shouldRunAfter, image, visible: true, ...!add?{checked: true}:{} }
        }
      })
      if(!modified) setModified(true)
      if(drafted) setDrafted(false)
      if(!checked && !add) setChecked(true)
    }
  
  }, [checked, dimensions, modified, dispatch, drafted, handleZindex, image, scamData, setDrafted, setModified, shouldRunAfter, visible])

  const handleKeyDown = useCallback( () => {
    if(keyDown == 'Delete' && selectedId != null) {
      removeId(selectedId)
      setKeyDown('')
    } else if(keyDown.startsWith("CTRL+")){
      //debug("key:", keyDown, focused, image.thumbnail_path)      
      if(selectedId != null && keyDown === "CTRL+C"  && typeof scamData === "object" && scamData.rects ) {
        //debug(scamData.rects[selectedId])
        const page_n = scamData.rects.findIndex(r => r.n === selectedId) 
        setClipboard({ ...scamData.rects[page_n] })
      } else if(selectedId != null && keyDown === "CTRL+X"  && typeof scamData === "object" && scamData.rects) {
        const page_n = scamData.rects.findIndex(r => r.n === selectedId) 
        setClipboard({ ...scamData.rects[page_n] })
        removeId(selectedId)
      } else if(focused === image.thumbnail_path && keyDown === "CTRL+V") { 
        //debug(clipboard)
        if(clipboard) { 
          const n = typeof scamData === "object" ? scamData?.rects?.length ?? 0 : 0
          selectShape(null)
          onChange({...clipboard, n}, true)
          selectShape(n)
        }

      }
      setKeyDown('')
    }
  }, [keyDown, selectedId, scamData, removeId, setKeyDown, setClipboard, clipboard, onChange, focused, image])

  useEffect(()=>{
    handleKeyDown()
  }, [keyDown])

  useEffect(() => {
    if (typeof scamData === 'object' && scamData.rects && scamData.selected != selectedId && selectedId != undefined) {
      // handling z-index the react-konva way (https://konvajs.org/docs/react/zIndex.html)
      const rects = handleZindex(scamData.rects)
      setScamData({ ...scamData, selected: selectedId, rects })
    }
  }, [handleZindex, scamData, selectedId])

  const handleMouseDown = useCallback((event:KonvaEventObject<MouseEvent>) => {

    if(focused != image.thumbnail_path) setFocused(image.thumbnail_path)

    const container = event.target.getStage()?.container();
    if (addNew || container?.style.cursor == "copy") {
      //if (typeof scamData !== 'object' || !scamData.pages) return
      if (newPage.length === 0) {
        setAddNew(true)
        const stage = event.target.getStage()
        if(!stage) return
        const vect = stage.getPointerPosition() 
        if(!vect) return
        const { x, y } = vect
        const len = typeof scamData === 'object' ? scamData.pages?.length ?? 0 : 0
        setNewPage([{ x, y, width: 0, height: 0, n: len, rotation:0, warning:false }]);
        selectShape(len)
      }
    } else {
      checkDeselect(event)
    }
  }, [addNew, focused, image.thumbnail_path, newPage.length, scamData, setFocused]);

  const handleMouseUp = (event:KonvaEventObject<MouseEvent>) => {
    //if (typeof scamData !== 'object' || !scamData.pages) return
    if (newPage.length === 1) {
      const sx = newPage[0].x;
      const sy = newPage[0].y;
      const stage = event.target.getStage()
      if(!stage) return
      const vect = stage.getPointerPosition() 
      if(!vect) return
      let { x, y } = vect;
      if(x <= padding) x = padding
      if(y <= padding) y = padding
      if(x >= stage.attrs.width - padding - 1) x = stage.attrs.width - padding - 1
      if(y >= stage.attrs.height - padding - 1) y = stage.attrs.height - padding - 1
      if(x !== sx && y !== sy) { 
        const annotationToAdd = {
          ...newPage[0],
          x: Math.min(sx, x) - padding,
          y: Math.min(sy, y) - padding,
          width: Math.abs(x - sx),
          height: Math.abs(y - sy)
        };        
        onChange(annotationToAdd, true)
      } else {
        selectShape(null)
      }
      setAddNew(false)
      setNewPage([]);
    }
  };

  const handleMouseMove = (event:KonvaEventObject<MouseEvent>) => {
    //if (typeof scamData !== 'object' || !scamData.pages) return
    if (newPage.length === 1) {
      const sx = newPage[0].x;
      const sy = newPage[0].y;
      const stage = event.target.getStage()
      if(!stage) return
      const vect = stage.getPointerPosition() 
      if(!vect) return
      let { x, y } = vect;
      if(x <= padding) x = padding
      if(y <= padding) y = padding
      if(x >= stage.attrs.width - padding - 1) x = stage.attrs.width - padding - 1
      if(y >= stage.attrs.height - padding - 1) y = stage.attrs.height - padding - 1
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
    const newImage = {...image, thumbnail_info:{ ...image.thumbnail_info, rotation }, rotation }
    if(newImage.pages) delete newImage.pages
    setImageData(newImage)    
    if(modified) setDrafted(false) 
    setModified(true)
    setLastRun(1)
    if(!checked) setChecked(true)
  }, [ modified, image, shouldRunAfter ])

  const toggleVisible = useCallback(() => {
    dispatch({
      type: 'UPDATE_DATA',
      payload: {
        id: image.thumbnail_path,
        val: { state: 'modified', time: shouldRunAfter, visible: !visible, checked: true }
      }
    })
    setVisible(!visible)
    if(modified) setDrafted(false) 
    setModified(true)
    setImageData({...image, hidden: visible })    
    if(!checked) setChecked(true)
  }, [checked, dispatch, image, scamData, setModified, setVisible, shouldRunAfter, visible, modified])

  const toggleCheck = useCallback((multi?:boolean) => {
    if(!multi) {
      dispatch({
        type: 'UPDATE_DATA',
        payload: {
          id: image.thumbnail_path,
          val: { state: 'modified', time: shouldRunAfter, checked: !checked }
        }
      })
      setChecked(!checked) 
      setImageData({...image, checked: !checked })    
    } else {
      let keys = _.orderBy(Object.keys(allScamData))
      keys = keys.slice(0, keys.indexOf(image.thumbnail_path) + 1)
      //debug("aSD:", keys) 
      dispatch({
        type: 'UPDATE_DATA_MULTI',
        payload: {
          multid: keys,
          val: { state: 'modified', time: shouldRunAfter, checked: !checked }
        }
      })
      setImageData(keys.map(k => ({...allScamData[k].image, checked: !checked })))
    }
    if(modified) setDrafted(false) 
    setModified(true)
  }, [checked, dispatch, image, scamData, setModified, shouldRunAfter, visible, allScamData, modified])  
  
  const [checkedRestrict, setCheckedRestrict] = useAtom(state.checkedRestrict)

  useEffect( () => {
    if(typeof scamData === 'object') { 
      const numP = (checkedRestrict ? scamOptionsSelected.nbPages : scamOptions.nbPages) ?? scam_options.nb_pages_expected
      if(scamData?.rects?.length != numP || scamData?.rects?.some(r => r.warning)) {
        setWarning(true)
      } else {
        setWarning(false)
      }
    }
  }, [ scamData, globalData, scamOptions, scamOptionsSelected, checkedRestrict ])

  const actualW = (portrait ? dimensions.height : dimensions.width)
  const actualH = (portrait ? dimensions.width : dimensions.height)
 
  //debug("dim:",image.thumbnail_path, dimensions, actualW, actualH, portrait)
  
  const loading = scamData === true || scamQueue.todo?.length && scamQueue.todo?.includes(image.thumbnail_path) && !scamQueue.done?.includes(image.thumbnail_path)

  return (<div ref={divRef} className={"scam-image" + (loading ? " loading" : "") + ( scamData != true && warning && !checked && visible ? " has-warning" : "") 
      + (typeof scamData === "object" ? (" filter-" + filter) + (" checked-"+checked) + (" warning-" + warning) : "" ) + (" grid-" + grid) + (" focus-" + (focused === image.thumbnail_path))}
    style={{ height: visible ? actualH + 2 * padding : 80, maxWidth: image.thumbnail_info[portrait ? "height":"width"] + 2*padding }}
    onMouseDown={checkDeselectDiv}
  >
    <figure className={"visible-"+visible + " newPage-"+(newPage.length > 0) + " selected-"+(selectedId == null ? "false":"true")} ref={figureRef} 
        // {... !visible ? { style: { width: dimensions.width + padding * 2, height: 80 } }:{} }
        >
      { !visible && typeof konvaImg == "object" && <img src={konvaImg?.src} className={"mini"+((image.rotation + 360) % 360 != 0 ? " rotated": "")} style={{transform: "rotate("+image.rotation+"deg)" }}/> }
      { visible  && <Stage        
        width={actualW + padding * 2}
        height={actualH + padding * 2}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onTouchStart={checkDeselect}        
      >
        <Layer>
          {typeof konvaImg === 'object' && <>
            <KImage
              image={konvaImg}
              width={dimensions.width}
              height={dimensions.height}
              //x={padding + ([90,180].includes(image.rotation) ? actualW : 0)}
              //y={padding + ([180,270].includes(image.rotation) ? actualH : 0)}
              x={actualW / 2 + padding}
              y={actualH / 2 + padding}
              rotation={360 - image.rotation}
              offsetX={dimensions.width / 2}
              offsetY={dimensions.height / 2}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container/* && addNew*/) container.style.cursor = "copy";
              }}
              onMouseMove={(e) => {
                const container = e.target.getStage()?.container();
                if (container /*&& !addNew*/ && container.style.cursor != "copy") container.style.cursor = "copy";
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
                shapeProps={!checked || !rect.warning ? rect : { ...rect, warning: false }}
                isSelected={rect.n === selectedId}
                onSelect={() => onSelect(rect.n)}
                {...{ onChange, addNew, portrait, ...scamData?.pages && scamData?.pages[i] ? {page: scamData?.pages[i]}: {}   }}
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
              globalCompositeOperation="exclusion"
              stroke="white"              
            />
          )}
        </Layer>
      </Stage> }
      <figcaption><FormControlLabel label={image.img_path} onChange={(ev) => handleSelectItem(ev, !selected, image.thumbnail_path)} control={<Checkbox checked={selected} sx={{padding: "0 8px" }}/>}  />
        { scamData != true && visible && warning && !checked && <Warning sx={{ position: "absolute", color: "orange", marginLeft: "5px", marginTop: "4px" }} /> }
        {/* <WarningAmber sx={{ position: "absolute", opacity:"50%" }} /> */}
        { !loading && typeof scamData !== "object" && <span title="no data yet"><ErrorOutline sx={{ position: "absolute", color: "black", opacity:0.5, marginLeft: "5px", marginTop: "2px" }} /></span> }
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