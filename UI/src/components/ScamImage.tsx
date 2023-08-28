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
            });
          }
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
            return newBox;
          }}
        />
      )}
    </>
  )
}


export const ScamImageContainer = (props: { folder: string, image: ScamImageData, config: ConfigData, draft: SavedScamData, loadDraft: boolean|undefined, setImageData: (data:ScamImageData) => void }) => {
  const { image } = props;

  const { ref, inView, entry } = useInView({
    triggerOnce: false,
    rootMargin: '200% 0px'
  });

  const [visible, setVisible] = useState(image.hidden ? false : true)
  const [checked, setChecked] = useState(image.checked ? true : false)
  
  const figureRef = useRef<HTMLElement>(null)
  
  const [grid, setGrid] = useAtom(state.grid)  

  if (inView) {    
    //debug("scanImageContainer:", image.thumbnail_path, JSON.stringify(props, null, 3))
    return <ScamImage {...props} divRef={ref} {...{visible, checked, setVisible, setChecked}}/>
  }
  else {    

    const w = (figureRef.current?.parentElement?.offsetWidth || 0) - 2 * padding
    const h = w * image.thumbnail_info.height / image.thumbnail_info.width

    return (
      <div ref={ref} className={"scam-image not-visible" + (" grid-" + grid)}
        style={{ height: h + 2 * padding, maxWidth: image.thumbnail_info.width + 2*padding }}
      >
        <figure ref={figureRef}>
          <figcaption>{image.img_path}</figcaption>
        </figure>
      </div>
    )
  }
}

let unmount = false


export const recomputeCoords = (r: Page, i: number, w: number, h: number, W: number, H: number) => {
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
    loadDraft: boolean | undefined, checked: boolean,
    setImageData:(data:ScamImageData)=>void, setVisible:(b:boolean) => void, setChecked:(b:boolean) => void }) => {
  const { folder, config, image, divRef, draft, loadDraft, visible, checked, setImageData, setVisible, setChecked } = props;

  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const windowSize = useWindowSize();

  const [filter, setFilter] = useAtom(state.filter)
  const [grid, setGrid] = useAtom(state.grid)  

  const [dimensions, setDimensions] = useState({
    width: 0,
    height: image.thumbnail_info.height
  })
  const figureRef = useRef<HTMLElement>(null)

  useEffect(() => {    
    if (figureRef.current?.parentElement) { 
      const w = (figureRef.current?.parentElement?.offsetWidth || 0) - 2 * padding 
      if(w != dimensions.width) {
        setDimensions({
          width: w,
          height: w * image.height / image.width
        })
      }
    }    
  }, [grid, figureRef, dimensions, image, windowSize])


  let tmpPages ;
  const uploadedData = image?.pages ? { 
      ...image, 
      pages: (tmpPages = image.pages.map((p) => withRotatedHandle(p, image)) as Page[]),
      rects: tmpPages.map((r, i) => recomputeCoords(r, i, dimensions.width, dimensions.height, image.width, image.height))
    } : null
  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const globalData = allScamData[image.thumbnail_path]

  const [modified, setModified] = useAtom(state.modified)
  const [drafted, setDrafted] = useAtom(state.drafted)

  const [scamData, setScamData] = useState<ScamImageData | boolean>(uploadedData || (globalData?.time >= shouldRunAfter ? globalData.data : false))
  const [lastRun, setLastRun] = useState(globalData?.time <= shouldRunAfter ? globalData.time : 0)

  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | boolean>(false)
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    setPortrait([90,270].includes(image.rotation) ? true : false)
  }, [image.rotation])

  const [showDebug, setShowDebug] = useState(false)
  const [selectedId, selectShape] = useState<number | null>(null);
  const [addNew, setAddNew] = useState(false)
  const [newPage, setNewPage] = useState<KonvaPage[]>([]);

  const [warning, setWarning] = useState(false)
  
  const [orient, setOrient] = useAtom(state.orientAtom)
  const [direc, setDirec] = useAtom(state.direcAtom)
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)
  const [configReady, setConfigReady] = useAtom(state.configReady)
  
  const [keyDown, setKeyDown] = useAtom(state.keyDown)
  const [focused, setFocused] = useAtom(state.focused)

  const [deselectAll, setDeselectAll] = useAtom(state.deselectAll)
  
  useEffect(() => {
    //debug("des:", image.thumbnail_path, deselectAll)
    if(deselectAll) selectShape(null)
  }, [deselectAll])

  useEffect(() => {
    if(selectedId != null && deselectAll) setDeselectAll(false)
  }, [selectedId, deselectAll])

  const scamOptions:ScamOptionsMap = useMemo(() => { 
    const opts = ({
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
    })
    //debug("opts!", image.thumbnail_path, opts)
    return opts
  }, [ orient, direc, minRatio, maxRatio, nbPages ])

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

  const getScamResults = useCallback(() => {
    const now = Date.now()

    //debug("gSR!", configReady, scamOptions, loadDraft, draft, globalData, typeof scamData === 'object' && scamData.pages)    

    if (configReady != false && visible && config.auth && scamData != true && (lastRun == 1 || lastRun < shouldRunAfter || typeof scamData === 'object' && image.rotation != scamData.rotation)) {
      
      if(loadDraft === undefined) return
      else if(loadDraft && draft && !scamData) {        
        
        debug("draft:", draft);

        const newData = {
          ...draft.data,
          rects: draft.data.pages?.map((r, i) => recomputeCoords(r, i, dimensions.width, dimensions.height, draft.data.width, draft.data.height))
        }
        setScamData(newData)
        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: newData, state: 'draft', time: shouldRunAfter, image: draft.image, visible: draft.visible, checked: draft.checked }
          }
        })
        if(visible != draft.visible) setVisible(draft.visible)
        if(checked != draft.checked) setChecked(draft.checked)
        return
      }

      if(typeof scamData == "object" && image.pages && !globalData) {

        //debug("previously uploaded data:", scamData)

        dispatch({
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data: { ...scamData }, state: 'uploaded', time: shouldRunAfter, image: image, visible, checked }
          }
        })
        return
      }

      if(checked) return 

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
          debug("json:", response.data);
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
  }, [configReady, scamOptions, loadDraft, draft, globalData, scamData, visible, config.auth, lastRun, shouldRunAfter, image, checked, folder, controller.signal, 
      dispatch, setVisible, setChecked, 
      dimensions.width, dimensions.height])

  
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
    debug("deselec:", e.target.nodeType, e.target.attrs.image)
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs.image;
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };
  const checkDeselectDiv: MouseEventHandler<HTMLDivElement> = (e) => {
    debug("deselec div:", (e.target as HTMLDivElement).nodeName)
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
      const w = dimensions.width
      const h = dimensions.height
        
      newData.pages = [...scamData.pages.filter((_im,n) => n !== id)]
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
      selectShape(newData.pages.length ? newData.pages.length - 1 : null)
    }
  }, [checked, dimensions.height, dimensions.width, dispatch, handleZindex, image, scamData, setModified, shouldRunAfter, visible])

  useEffect(() => {
    if(focused != image.thumbnail_path) {
      selectShape(null)
    }
  }, [focused, image.thumbnail_path])

  useEffect(()=>{
    if(selectedId != null && keyDown == 'Delete') {
      removeId(selectedId)
      setKeyDown('')
    }
  }, [selectedId, keyDown, removeId, setKeyDown])


  const onChange = useCallback((p: KonvaPage, add?: boolean) => {
    if (typeof scamData === 'object' && scamData.pages) {
      const data = { ...scamData }

      if(scamData.pages.length <= p.n && data.pages) {
        if(!add) return
        data.pages.push({ minAreaRect:[0,0,0,0,0], warnings:[] })
      }

      const W = scamData?.width
      const H = scamData?.height
      const w = dimensions.width
      const h = dimensions.height

      if (data.pages) {
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
          type: 'ADD_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { data, state: 'modified', time: shouldRunAfter, image, visible, checked }
          }
        })
        setModified(true)
        if(drafted) setDrafted(false)
      }
    }
  }, [checked, dimensions.height, dimensions.width, dispatch, drafted, handleZindex, image, scamData, setDrafted, setModified, shouldRunAfter, visible])

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
      if (typeof scamData !== 'object' || !scamData.pages) return
      if (newPage.length === 0) {
        setAddNew(true)
        const stage = event.target.getStage()
        if(!stage) return
        const vect = stage.getPointerPosition() 
        if(!vect) return
        const { x, y } = vect
        setNewPage([{ x, y, width: 0, height: 0, n: scamData.pages?.length, rotation:0, warning:false }]);
        selectShape(scamData.pages?.length)
      }
    } else {
      checkDeselect(event)
    }
  }, [addNew, focused, image.thumbnail_path, newPage.length, scamData, setFocused]);

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
          x: Math.min(sx, x) - padding,
          y: Math.min(sy, y) - padding,
          width: Math.abs(x - sx),
          height: Math.abs(y - sy)
        };        
        onChange(annotationToAdd, true)
      } 
      setAddNew(false)
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

  const actualW = (portrait ? dimensions.height : dimensions.width)
  const actualH = (portrait ? dimensions.width : dimensions.height)

  //debug("dim:",image.thumbnail_path, dimensions, actualW, actualH)

  return (<div ref={divRef} className={"scam-image" + (scamData === true ? " loading" : "") + ( scamData != true && warning && !checked && visible ? " has-warning" : "") 
      + (typeof scamData === "object" ? (" filter-" + filter) + (" checked-"+checked) + (" warning-" + warning) : "" ) + (" grid-" + grid)}
    style={{ height: visible ? actualH + 2 * padding : 80, maxWidth: image.thumbnail_info.width + 2*padding }}
    onMouseDown={checkDeselectDiv}
  >
    <figure className={"visible-"+visible} ref={figureRef} 
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
