import { useCallback, useEffect, useState, useMemo, MouseEventHandler } from 'react'
import axios from 'axios';
import debugFactory from "debug"
import { encode } from "js-base64"
import { ThemeProvider } from '@mui/material/styles';
import { useLocation, useSearchParams } from "react-router-dom";
import { Close } from '@mui/icons-material';
import { Dialog, DialogTitle, DialogContent, IconButton, DialogActions, TextField } from '@mui/material';
import { useAtom } from 'jotai';

// tmp data
//import data from "./assets/scam.json"

import { ScamImageContainer, recomputeCoords, rotatePage90, withRotatedHandle, withoutRotatedHandle } from "./components/ScamImage"
import './App.css'
import { ConfigData, LocalData, Page, SavedScamData, ScamData, ScamImageData, ScamOptions, ScamOptionsMap } from './types';
import { BottomBar } from './components/BottomBar';
import { TopBar } from './components/TopBar';
import { ColorButton, theme } from "./components/theme"
import * as state from "./state"

const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

export const discardDraft = async (folder: string) => {
  const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
  if(local.drafts && local.drafts[folder]) delete local.drafts[folder] 
  localStorage.setItem("scamUI", JSON.stringify(local))
}

export const scam_options: ScamOptionsMap = {
  "alter_checked": false,
  "direction": "vertical",
  "squarishness_min": 0.85,
  "squarishness_min_warn": 0.7,
  "nb_pages_expected": 2,
  "wh_ratio_range": [2.0, 7.0],
  "wh_ratio_range_warn": [1.5, 10],
  "area_ratio_range": [0.2, 0.5],
  "area_diff_max": 0.15,
  "area_diff_max_warn": 0.7,
  "use_rotation": true,
  "fixed_width": null,
  "fixed_height": null,
  "expand_to_fixed": false,
  "cut_at_fixed": false
}

let oldHandleSelectStart: { (this: Window, ev: Event): any; (ev: any): void; (this: Window, ev: Event): any; } | null = null

let oldHandleKeyUp: { (this: Window, ev: KeyboardEvent): void; (): void; }, 
  oldHandleKeyDown: { (this: Window, ev: KeyboardEvent): any; (this: Window, ev: KeyboardEvent): any; }

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData | boolean>(false)
  const [jsonPath, setJsonPath] = useState("")

  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams({});
  const paramFolder = searchParams.get("folder") || "";
  const [ folder, setFolder ] = useState(paramFolder);
  
  const [keyDown, setKeyDown] = useAtom(state.keyDown)

  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [lastSelectedItem, setLastSelectedItem] = useState("")

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  
  const [showSettings, setShowSettings] = useAtom(state.showSettings)

  const handleSelectStart = useCallback((ev: { preventDefault: () => void; }) => {
    if (keyDown == "Shift") {
      ev.preventDefault();
    }
  }, [keyDown])

  useEffect(() => {
    if(oldHandleSelectStart) window.removeEventListener('selectstart', oldHandleSelectStart);   
    window.addEventListener('selectstart', handleSelectStart);   
    oldHandleSelectStart = handleSelectStart
  }, [handleSelectStart])

  const [scamOptions, setScamOptions] = useAtom(state.scamOptions)
  
  const [restrictRun, setRestrictRun] = useAtom(state.restrictRun)
  const [checkedRestrict, setCheckedRestrict] = useAtom(state.checkedRestrict)
  
  // cf tutorial https://tj.ie/multi-select-checkboxes-with-react/
  const handleSelectItem = useCallback((ev: React.SyntheticEvent, val: boolean, label: string) => {

    const getNewSelectedItems = (value: string) => {      
      const currentSelectedIndex = images.findIndex(image => image.thumbnail_path === value);
      const lastSelectedIndex = images.findIndex(image => image.thumbnail_path === lastSelectedItem)    
      return images
        .slice(
          Math.min(lastSelectedIndex, currentSelectedIndex),
          Math.max(lastSelectedIndex, currentSelectedIndex) + 1
        )
        .map(image => image.thumbnail_path);
    }

    const getNextValue = (value: string) => {
      const isShiftDown = keyDown == "Shift"
      const hasBeenSelected = !selectedItems.includes(value);
    
      if (isShiftDown) {
        const newSelectedItems = getNewSelectedItems(value);
        // de-dupe the array using a Set
        const selections = [...new Set([...selectedItems, ...newSelectedItems])];    
        if (!hasBeenSelected) {
          return selections.filter(item => !newSelectedItems.includes(item));
        }    
        return selections;
      }
    
      // if it's already in there, remove it, otherwise append it
      return selectedItems.includes(value)
        ? selectedItems.filter(item => item !== value)
        : [...selectedItems, value];
    }

    const nextValue = getNextValue(label);

    debug(ev, val, label, nextValue)
  
    setSelectedItems(nextValue)
    setLastSelectedItem(label)

    if(val && nextValue.length >= 1) {
      setCheckedRestrict(true)
    } else if (!nextValue.length) {      
      setCheckedRestrict(false)
      setRestrictRun(false)
      setOptions(scamOptions)
    }

  }, [allScamData, images, keyDown, lastSelectedItem, scamOptions, selectedItems])

  const handleKeyDown = useCallback((ev:KeyboardEvent) => {
    //debug("down", ev, showSettings)
    if(!showSettings) { 
      if((ev.ctrlKey || ev.metaKey) && ["C","V","X"].includes(ev.key.toUpperCase())) setKeyDown("CTRL+"+ev.key.toUpperCase())
      else setKeyDown(ev.key)
    }
    if(ev.key == " ") {
      ev.preventDefault()
      let next:any, nextBB:any
      document.querySelectorAll(".scam-image:not(.not-visible)").forEach((e) => {
        const bbox = e.getBoundingClientRect()        
        if(!ev.shiftKey) {
          if(!next && bbox.top < window.innerHeight && bbox.bottom > window.innerHeight ) {
            //debug(i, bbox.y, bbox.x, e)
            next = e
            nextBB = bbox
          } else if(next && bbox.top < nextBB.top) {
            next = e
            nextBB = bbox
          }
        } else {
          if(!next && bbox.bottom > 0 && bbox.top < 0 ) {
            //debug(i, bbox.y, bbox.x, e)
            next = e
            nextBB = bbox
          } else if(next && bbox.bottom > nextBB.bottom && bbox.bottom > 0 && bbox.top < 0) {
            next = e
            nextBB = bbox
          }
        }
      })
      if(next) next.scrollIntoView()
    }
  }, [showSettings])

  const handleKeyUp = useCallback(() => {
    //debug("up", showSettings)
    if(!showSettings) setKeyDown('')
  }, [showSettings])


  useEffect(() => {
  
    if(oldHandleKeyDown) window.removeEventListener('keydown', oldHandleKeyDown);
    if(oldHandleKeyUp) window.removeEventListener('keyup', oldHandleKeyUp);
    
    window.addEventListener('keydown', handleKeyDown);      
    window.addEventListener('keyup', handleKeyUp);      

    oldHandleKeyDown = handleKeyDown
    oldHandleKeyUp = handleKeyUp

  }, [handleKeyDown, handleKeyUp])


  useEffect(() => {
    return () => {
      if(oldHandleKeyDown) window.removeEventListener('keydown', oldHandleKeyDown);
      if(oldHandleKeyUp) window.removeEventListener('keyup', oldHandleKeyUp);
      if(oldHandleSelectStart) window.removeEventListener('selectstart', oldHandleSelectStart);   
    }
  }, []);


  const markChecked = useCallback((val:boolean) => {
    const newImages = [...images]
    for(const image of newImages) {
      if(selectedItems.includes(image.thumbnail_path)) {
        image.checked = val
        dispatch({
          type: 'UPDATE_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { checked: val, state: "modified" }
          }
        })
      }
    }
    setImages(newImages)
    setModified(true)
  }, [selectedItems, images])

  const markHidden = useCallback((val:boolean) => {
    const newImages = [...images]
    for(const image of newImages) {
      if(selectedItems.includes(image.thumbnail_path)) {
        image.hidden = val
        dispatch({
          type: 'UPDATE_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { visible: !val, state: "modified" }
          }
        })
      }
    }
    setImages(newImages)
    setModified(true)
  }, [selectedItems, images])

  const batchRotate = useCallback((angle:number) => {
    const newImages = [...images]
    for(const im in newImages) {
      const image = newImages[im]
      if(selectedItems.includes(image.thumbnail_path)) {

        let portrait = [90,270].includes(image.rotation)
        const rotation = (image.rotation + angle + 360) % 360    
        
        newImages[im] = {...image, thumbnail_info:{ ...image.thumbnail_info, rotation }, rotation }
        
        // #55
        const newData = allScamData[image.thumbnail_path]?.data 
          ?? (typeof json === "object" && json.files.find((im) => im?.thumbnail_path === image.thumbnail_path))
          ?? {}
                
        let toRotate = angle ;
        newData.rotation = rotation
        if(newData.pages) do { 
          const handleX = portrait ? image.height/2 : image.width/2
          const handleY = portrait ? image.width/2 : image.height/2
          newData.pages = newData.pages.map((p) => withRotatedHandle(rotatePage90(withoutRotatedHandle(p) as Page, Math.abs(toRotate) !== 180 ? toRotate : 90, handleX, handleY), newData) as Page)
          if(newData.rects) delete newData.rects
          // we rotate +/-90° by +/-90°
          if(toRotate === 180 || toRotate === -180) {
            portrait = !portrait
            toRotate = 90
          } else {
            toRotate = 0
          }
        } while(toRotate);
        
        dispatch({
          type: 'UPDATE_DATA',
          payload: {
            id: image.thumbnail_path,
            val: { state: "modified", data: newData }
          }
        })

      }
    }
    setImages(newImages)
    setModified(true)
    setDrafted(false)
  }, [selectedItems, images, allScamData, dispatch])

  useEffect(() => {
    debug("loca?",paramFolder,location)
    if(paramFolder) {
      if(paramFolder != folder) { 
        setFolder(paramFolder)
      }
    } else {
      setFolder("")      
    }

  }, [paramFolder, folder, location])

  const [ error, setError ] = useState("")

  const [ drafts, setDrafts ] = useState({} as  { [str:string] : SavedScamData })
  const [ loadDraft, setLoadDraft ] = useState<boolean|undefined>(false)

  const [modified, setModified] = useAtom(state.modified)
  const [drafted, setDrafted] = useAtom(state.drafted)

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
  const [expandToFixed, setExpandToFixed] = useAtom(state.expandToFixedAtom)
  const [configReady, setConfigReady] = useAtom(state.configReady)

  const [configs, setConfigs] = useAtom(state.configs)

  const [deselectAll, setDeselectAll] = useAtom(state.deselectAll)

  const saveSession = useCallback(async () => {
    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    if(!local.sessions) local.sessions = {}
    local.sessions[folder] = Date.now()
    localStorage.setItem("scamUI", JSON.stringify(local))
  }, [ folder ])

  // load config file onstartup
  useEffect(() => {
    axios.get('/config.json')
      .then(response => {
        setConfig(response.data)
      })
      .catch(error => {
        console.error(error);
      });
  }, [])

  useEffect( () => {

    debug("folder?", folder, json)

    // #6 fix when parenthesis in folder name (ex: X_Basgo_Complete/10 mDo/mDo 04 Nga (aus Phal chen)/
    const escapeRegExp = (str:string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if(config.auth && folder && (!json || typeof json === 'object' && jsonPath && !jsonPath.match(new RegExp("^"+escapeRegExp(folder))))) {

      if(folder && !folder.endsWith("/")) { 
        setFolder(folder+"/")
        return
      }

      setJson(true)
      axios.post(apiUrl + "get_scam_json", {
        folder_path: folder,
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: "Basic " + encode(config.auth.join(":"))
        },
      })
      .then(response => {
        debug("get:",response.data);

        setJson(response.data)
        setSearchParams({ folder })
        setError("")

        if(response.data.options_list?.length >= 1) { 
          setConfigs(response.data.options_list)
          setOptions(response.data.options_list[0])
        }

        saveSession()
      })
      .catch(error => {
        debug(error, json);
        
        setError(error.message)

        // use preloaded local data
        // setJson(data)
      });
    } else if(json && !folder) {
      setImages([])
      setJson(false)
    }
  }, [config, folder, json, jsonPath, setSearchParams])

  useEffect( () => {
    if(typeof json === 'object' && json.files) setImages(json.files)
  }, [json])

  const setImageData = useCallback((data:ScamImageData|ScamImageData[]) => {
    if(typeof json !== 'object') return
    if(!Array.isArray(data)) data = [ data ]
    for(const d of data) {
      const idx = json.files.findIndex((im) => im?.thumbnail_path === d?.thumbnail_path)
      debug("set:", d, d?.thumbnail_path, idx)
      const newJson = { ...json }
      newJson.files[idx] = { ...d }
      setJson(newJson)
    }
  }, [json])

  const handleClose = useCallback(async (discard?: boolean) => {
    setConfigReady(undefined)
    setModified(false)
    setLoadDraft(false)
    if(discard) {
      discardDraft(folder)
    }
  }, [folder])

  const handleLoad = () => {
    setLoadDraft(true)
    setDrafted(true)
  }

  
  useEffect(() => {
    debug("folder!", folder, loadDraft)    
    setJson(false)
    setModified(false)
    setError("")
    dispatch({ type: 'RESET_DATA' })
    setImages([])
    if(folder) {
      const hasDraft = ((JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).drafts || {} ) 
      if(hasDraft[folder]?.images) setModified(true)
      const theDraft = hasDraft[folder]?.images || {}
      if(theDraft) { 
        Object.values(theDraft).map(val => {
          if(val.data?.pages) {
            val.data.pages = val.data.pages.map(p => withRotatedHandle(p, val.data)) as Page[]      
          }
        })
      }
      setConfigReady(hasDraft[folder]?.images ? false : undefined)
      setDrafts( theDraft )
      setLoadDraft( hasDraft[folder]?.images ? undefined : false )
    }
  }, [folder])

  const setOptions = (options:ScamOptions) => {
    //debug("options:", options)
    setOrient(options.orient)
    if(options.direc) setDirec(options.direc)
    if(options.minRatio) setMinRatio(options.minRatio)
    if(options.maxRatio) setMaxRatio(options.maxRatio)
    if(options.nbPages) setNbPages(options.nbPages)    
    if(options.minAreaRatio) setMinAreaRatio(options.minAreaRatio)
    if(options.maxAreaRatio) setMaxAreaRatio(options.maxAreaRatio)
    if(options.minSquarish) setMinSquarish(options.minSquarish)
    if(options.fixedWidth) setFixedWidth(options.fixedWidth)
    if(options.fixedHeight) setFixedHeight(options.fixedHeight)
    if(options.cutAtFixed) setCutAtFixed(options.cutAtFixed)
    if(options.expandToFixed) setExpandToFixed(options.expandToFixed)
  }

  const options= {
    ...scam_options,  
    "wh_ratio_range": orient == "custom"
      ? [minRatio, maxRatio]
      : orient == "horizontal"
        ? [2.0, 7.0]
        : [0.6, 0.8], // TODO: check values for vertical mode    
    "wh_ratio_range_warn": [1.5, 10], // TODO: shouldn't it be updated w.r.t wh_ratio_range?
    "nb_pages_expected": orient == "custom" ? nbPages : scam_options.nb_pages_expected,
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
    "expand_to_fixed": orient == "custom" 
        ? expandToFixed
        : false,
    "fixed_width": orient == "custom" 
      ? fixedWidth
      : -1,
    "fixed_height": orient == "custom" 
      ? fixedHeight
      : -1,
  }

  useEffect(() => {
    const hasDraft = ((JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).drafts || {} ) 
    if(loadDraft) {
      const options = hasDraft[folder]?.options
      if(options) {
        setOptions(options)
        setConfigReady(true)
      }
    } 
  }, [loadDraft])
  
  useEffect(() => {
    if(typeof json === 'object' && jsonPath != json.folder_path) setJsonPath(json.folder_path)
  }, [json, jsonPath])
  

  useEffect(() => {
    if(loadDraft && drafts) {
      Object.values(drafts).map(v => setImageData(v.image))
    }
  }, [loadDraft, drafts])

  const checkDeselectMain: MouseEventHandler<HTMLElement> = (e) => {
    const clickedOnEmpty = ["MAIN"].includes((e.target as HTMLDivElement).nodeName.toUpperCase())
    if (clickedOnEmpty) {
      //debug("deselec main:", (e.target as HTMLElement).nodeName)
      setDeselectAll(true);
    }
  };

  const reloadDialog = useMemo(() => (
    <Dialog open={folder && loadDraft === undefined && Object.keys(drafts).length ? true : false} onClose={() => handleClose()} disableScrollLock={true} >
      <DialogTitle>Draft found</DialogTitle>
      <DialogContent>
        Load previous edits for '{folder}'?
        <IconButton
          edge="end"
          color="inherit"
          onClick={() => handleClose()}
          aria-label="close"
          style={{ position: 'absolute', top: 2, right: 14 }}
        >
          <Close />
        </IconButton>
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={() => handleClose(false)} >No</ColorButton>
        <ColorButton onClick={() => handleClose(true)} >Discard draft</ColorButton>
        <ColorButton onClick={handleLoad} >Yes</ColorButton>
      </DialogActions>
    </Dialog>
  ), [drafts, folder, handleClose, loadDraft])
  
  const [grid] = useAtom(state.grid)

  const [random, setRandom] = useAtom(state.random)
  const [outliar, setOutliar] = useAtom(state.outliar)

  return (
    <ThemeProvider theme={theme}>
      {reloadDialog}
      <header className={"folder-empty-"+(typeof json != "object")}><TopBar {...{ folder, config, error, json, jsonPath, setFolder }}/></header>
      <main onClick={checkDeselectMain} className={"main-grid-"+grid}>{
        images.map((image,i) => <ScamImageContainer selected={selectedItems.includes(image.thumbnail_path)} {...{ isOutliar:outliar[i] || false, isRandom:random[i] || false, folder, image, config, loadDraft, draft: drafts[image.thumbnail_path], setImageData, handleSelectItem }}/>)
      }</main>
      { typeof json == "object" && <footer><BottomBar {...{ ...loadDraft?{drafts}:{}, folder, config, ...typeof json === 'object'?{json, setJson}:{}, selectedItems, images, setSelectedItems, markChecked, markHidden, options, setOptions, batchRotate }}/></footer>}
    </ThemeProvider>
  )
}

export default App
