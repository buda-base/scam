import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, Button, ButtonProps, Popover, FormControlLabel, Checkbox, Popper, Paper, Stack, Slider } from "@mui/material"
import { ChangeEvent, ChangeEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Settings, Close, VolumeDown, LightMode, Contrast } from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import {
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle
} from '@mui/material';
import { useAtom } from "jotai";
import debugFactory from "debug"
import { encode } from "js-base64";
import _ from "lodash"

import { ConfigData, LocalData, Orientation, Page, SavedScamData, ScamData, ScamImageData, ScamOptions, ScamOptionsMap } from "../types"
import SettingsMenu from "./SettingsMenu";
import * as state from "../state"
import { ColorButton } from "./theme"
import { apiUrl, discardDraft, scam_options } from "../App";
import axios from "axios";
import { withRotatedHandle, withoutRotatedHandle, recomputeCoords, samePage } from "./ScamImage";
import CircularProgressWithLabel from "./CircularProgressWithLabel"

const debug = debugFactory("scam:bbar")

export const SaveButtons = (props: { drafts?:{ [str:string] : SavedScamData }, folder: string, config: ConfigData, json?:ScamData, selectedItems:string[], checkedRestrict: boolean, progress: number, hasWarning:ScamImageData[],
    setJson?:(s:ScamData)=>void }) => {
  const { drafts, folder, json, config, selectedItems, checkedRestrict, progress, hasWarning, setJson } = props;

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)

  const [modified, setModified] = useAtom(state.modified)
  const [published, setPublished] = useAtom(state.published)
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

  const [popChecked, setPopChecked] = useState(false)
  const [checked, setChecked] = useState(true)
  const spanRef = useRef<HTMLSpanElement>(null)

  const [ saving, setSaving ] = useState(false)
  const [ error, setError ] = useState("")

  //debug("mod:", modified, drafted, published)

  useEffect(() => {
    if(modified) {
      setDrafted(false)
      setPublished(false)
    }
  }, [modified])

  const [globalScamOptionsUpdate, setGlobalScamOptionsUpdate] = useAtom(state.globalScamOptionsUpdate)

  const [scamOptions, setScamOptions] = useAtom(state.scamOptions)
  const [scamOptionsSelected, setScamOptionsSelected] = useAtom(state.scamOptionsSelected)

  const updateOptions = useCallback(async () => {
    const opts:ScamOptions = { orient, ...orient === "custom" ? { direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, expandToFixed }:{} }
    //debug("opts!", opts, selectedItems.length, globalScamOptionsUpdate, checkedRestrict)
    if(selectedItems.length > 0 && !checkedRestrict || !selectedItems.length || globalScamOptionsUpdate) setScamOptions(opts)
    else setScamOptionsSelected(opts)    
    if(globalScamOptionsUpdate != false) setGlobalScamOptionsUpdate(false)

    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    local.options = { orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, expandToFixed }
    localStorage.setItem("scamUI", JSON.stringify(local))

  }, [orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, expandToFixed, selectedItems.length, checkedRestrict, globalScamOptionsUpdate, 
      setScamOptions, setScamOptionsSelected, setGlobalScamOptionsUpdate])   
    
  useEffect(() => {
    updateOptions()
  },[ orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, expandToFixed, selectedItems, globalScamOptionsUpdate])

  /*  
  useEffect(() =>  {
    debug("scamOpt:", scamOptions)
  }, [scamOptions])

  useEffect(() =>  {
    debug("scamOptSel:", scamOptionsSelected)
  }, [scamOptionsSelected])
  */
 
  const saveDraft = useCallback(async () => {
    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    if(!local.drafts) local.drafts = {}
    const images = local.drafts[folder]?.images ?? {}
    local.drafts[folder] = { 
      ...local.drafts[folder], 
      images: { ...images, ...Object.keys(allScamData).reduce( (acc,a) => {
        const val = allScamData[a]
        val.data = { ...val.data }
        // save rotation
        val.image = { ...val.data }
        if(val.image.pages) delete val.image.pages
        if(val.image.rects) delete val.image.rects
        // #9 always ungray save buttons after run_ (=> save previous scam run as draft)
        if(["new", "draft", "modified", "uploaded"].includes(val.state)) { 
          if(val.data.pages) val.data.pages = val.data.pages.filter((p,i) => !val.data.pages?.some((q,j) => samePage(p,q) && j > i)).map(withoutRotatedHandle) as Page[]
          return ({ ...acc, [a]: val })
        }
        return acc
      }, {}) },
      options: orient != "custom" ? { orient: orient as Orientation} : scamOptions // better keep global options now that custom options saved to localStorage // { ...selectedItems.length>0?scamOptionsSelected:scamOptions }
    }
    localStorage.setItem("scamUI", JSON.stringify(local))
    //setModified(false)
    setDrafted(true)
  }, [allScamData, folder, orient, scamOptions, scamOptionsSelected, selectedItems])


  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleCancelConfirm = () => {
    setShowConfirmDialog(false)
    setPopChecked(false)
  }
  
  const handleOkConfirm = useCallback(() => {
    setConfirmed(true)
    setShowConfirmDialog(false)    
  }, [confirmed,showConfirmDialog])

  useEffect(() => {
    if(confirmed) {
      publish()
    }
  }, [confirmed])

  const confirmDialog = useMemo( () => (
    <Dialog open={showConfirmDialog} disableScrollLock={true} >
      <DialogTitle>Warning</DialogTitle>
      <DialogContent>
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleCancelConfirm}
            aria-label="close"
            style={{ position: 'absolute', top: 2, right: 14 }}
          >
            <Close />
          </IconButton> 
          Some unchecked images have a warning, proceed anyway?
        </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleCancelConfirm}>Cancel</ColorButton>
        <ColorButton onClick={handleOkConfirm}>Ok</ColorButton>
      </DialogActions>
    </Dialog>
  ), [showConfirmDialog])

  //debug("dial:", showConfirmDialog, confirmed)



  const publish = useCallback(async () => {

    debug("pub:",checked,confirmed,showConfirmDialog)
    
    if(checked && hasWarning.length > 0 && !confirmed)  {
      setShowConfirmDialog(true)
      return 
    }

    setSaving(true)
    
    const configs:ScamOptions[] = [{ ...scamOptions }]
    const toSave = { 
      ...json, 
      files: json?.files.map(j => {
        const obj = allScamData[j.thumbnail_path] || drafts && drafts[j.thumbnail_path] || {}
        let currentConfig = !obj.options ? 0 : configs.findIndex(c => _.isEqual(c, obj.options))
        if(obj.options && currentConfig == -1) {
          configs.push(obj.options)
          currentConfig = configs.length - 1
        }        
        let data = { 
          ...j,
          ...obj.data || {},
          ...currentConfig > 0 ? {options_index: currentConfig} : {}
        }
        
        let hidden = data.hidden
        if(obj.visible) hidden = undefined
        let checked:boolean|undefined = data.checked || obj.checked
        if(obj.checked === false) checked = undefined
        
        if(data.hidden != undefined) delete data.hidden
        if(data.checked != undefined) delete data.checked        
        
        // better fix for #36
        data = { ...data, hidden, checked }

        if(data.rects) delete data.rects
        if(data.pages) data.pages = data.pages.filter((p,i) => !data.pages?.some((q,j) => samePage(p,q) && j > i)).map(withoutRotatedHandle) as Page[]
        return data
      }),
      checked,
      pages_order: false, // as long as the UI doesn't allow user to reorder annotations
      options_list: configs
    }
    
    debug("publish", json, allScamData, toSave, configs)

    axios.post(apiUrl + "save_scam_json", {
      folder_path: folder,
      scam_json_obj: toSave
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: "Basic " + encode(config.auth.join(":"))
      },
    })
    .then(response => {
      debug("save:",response.data);

      setSaving(false)
      setPopChecked(false)
      setModified(false)
      setPublished(true)
      discardDraft(folder)
      setDrafted(true)
      setConfirmed(false)

      if(typeof json === "object" && setJson) setJson({...json, ...checked ? {checked: "local"}:{}})
    })
    .catch(error => {
      debug(error, json);
      
      setSaving(false)
      setError(error.message)
      setConfirmed(false)

    });

    
  }, [allScamData, checked, config.auth, confirmed, folder, hasWarning.length, json, scamOptions, setDrafted, setModified])

  const handleClosePop = () => {
    setPopChecked(false)
    setError("")
  }

  const handleChecked = (e: ChangeEvent<HTMLInputElement>) => {
    setChecked(e.target.checked)
  }

  const handlePublish = useCallback( () => {    
    if(error) handleClosePop()
    else if(!popChecked) setPopChecked(true)
    else publish()
  }, [error, popChecked, publish])

  return (
    <>
      {confirmDialog}
      { (popChecked || error != "") && <div onClick={handleClosePop}>
        <div className="popper-bg"></div>
        {/* 
        <div className="popper-bg-bar"></div>
        <div className="popper-bg-bar-right"></div> 
        */}
      </div>
      }
      <Popper open={popChecked || error != ""} anchorEl={spanRef.current} popperOptions={{ placement: "bottom-end" }}>
        <Paper className={"paper error-"+(error != "" ? true : false)} >
          { !error 
            ? <FormControlLabel control={<Checkbox checked={checked} onChange={handleChecked}/>} label="review complete " /> 
            : <>Failed to save<br/>(<i>{error}</i>)</> }
        </Paper>
      </Popper>
      <ColorButton onClick={saveDraft} disabled={progress != 100 || !modified || drafted || popChecked}>save draft</ColorButton>
      <span ref={spanRef}>
        <ColorButton className={saving?"saving":""} sx={{ marginLeft:"8px" }} onClick={handlePublish} disabled={progress != 100 || !modified || published || !config.auth ||  saving}>{ 
          saving 
          ? "_" 
          : error 
            ? "cancel"
            : popChecked 
              ? "ok"
              : "upload" 
        }</ColorButton>
      </span>
    </>
  )
}

let unmount = false, go = false, abort = false

export const BottomBar = (props: { drafts?:{ [str:string] : SavedScamData }, folder:string, config: ConfigData, json?:ScamData, selectedItems:string[], images: ScamImageData[], options: ScamOptionsMap,
    setSelectedItems:(i:string[]) => void, markChecked:(b:boolean) => void, markHidden:(b:boolean) => void, setOptions:(opt:ScamOptions) => void, setJson?:(s:ScamData)=>void, 
    batchRotate:(n:number) => void }) => {
  const { drafts, folder, config, json, selectedItems, images, options, setSelectedItems, markChecked, markHidden, setOptions, setJson, batchRotate } = props;

  const [showSettings, setShowSettings] = useAtom(state.showSettings)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [restrictRun, setRestrictRun] = useAtom(state.restrictRun)
  const [checkedRestrict, setCheckedRestrict] = useAtom(state.checkedRestrict)
  const [checkedRestrictWarning, setCheckedRestrictWarning] = useAtom(state.checkedRestrictWarning)

  const [globalScamOptionsUpdate, setGlobalScamOptionsUpdate] = useAtom(state.globalScamOptionsUpdate)

  const handleClose = () => { 
    setShowSettings(false); 
  };

  const [scamOptions, setScamOptions] = useAtom(state.scamOptions)

  const [modified, setModified] = useAtom(state.modified)
  const [published, setPublished] = useAtom(state.published)
  const [drafted, setDrafted] = useAtom(state.drafted)

  const handleRun = useCallback(() => { 
    setShouldRunAfter(Date.now()); 
    setShowSettings(false);  
    if(selectedItems.length > 0 && !checkedRestrict) setGlobalScamOptionsUpdate(true)    
    if(restrictRun != checkedRestrict) { 
      setRestrictRun(checkedRestrict)
      if(checkedRestrict) setTimeout(() => {
        setRestrictRun(false)
        setTimeout(() => {
          setOptions(scamOptionsSelected)          
        }, 150)
      }, 150)
    }
  }, [restrictRun, selectedItems, checkedRestrict, scamOptions, setRestrictRun, setShouldRunAfter])

  const [scamOptionsSelected, setScamOptionsSelected] = useAtom(state.scamOptionsSelected)

  const handleSettings = useCallback(() => {
    if(selectedItems.length > 0) {
      setCheckedRestrict(true)      
      let found = false
      for(const it of selectedItems) { 
        if(allScamData[it]?.options) {
          setOptions(allScamData[it].options as ScamOptions)
          found = true
          break ;
        }
        if(!found) setOptions(scamOptionsSelected)
      } 
    }
    setShowSettings(true)
  }, [scamOptionsSelected, selectedItems, allScamData, scamOptions])

  const [selectedImages, setSelectedImages] = useState<ScamImageData[]>([])
  useEffect(() => {
    setSelectedImages(images.filter(im => selectedItems.includes(im.thumbnail_path)))
  }, [images, selectedItems])
  
  /*
  useEffect( () =>  {
    debug("data:",allScamData)
  }, [allScamData])
  */
  
  let controller = new AbortController();   

  const [filter, setFilter] = useAtom(state.filter)
  const [grid, setGrid] = useAtom(state.grid)
  useEffect(() => {
    const restoreGrid = async () => {
      const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
      if(local.grid) setGrid(local.grid)
    }
    restoreGrid()

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


  const hasChecked = selectedImages.some(im => allScamData[im.thumbnail_path]?.checked)
  const hasUnchecked = selectedImages.some(im => !allScamData[im.thumbnail_path]?.checked)
  const hasHidden = selectedImages.some(im => allScamData[im.thumbnail_path]?.visible === false)
  const hasVisible = selectedImages.some(im => allScamData[im.thumbnail_path]?.visible)

  const handleDeselectAll = () => {
    setCheckedRestrict(false)
    setRestrictRun(false)
    setOptions(scamOptions)
    setSelectedItems([])
  }

  const saveGrid = useCallback(async () => {
    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    local.grid = grid
    localStorage.setItem("scamUI", JSON.stringify(local))
  }, [ grid])

  useEffect(() => { 
    saveGrid() 
  }, [grid])
  
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)

  const calcHasWarning = useCallback((im:ScamImageData) => { 
    let image, numAnno, expectedNumAnno
    return ((image = allScamData[im.thumbnail_path] ?? im).data ?? image).pages && (!im.hidden || image.visible) && image.visible != false && (
      (image?.data ?? image).pages?.some(p => p.warnings?.length) 
        || (numAnno = (image?.data ?? image).pages?.length) != (expectedNumAnno = (
            image?.options?.nbPages ?? (
              (
                !allScamData[im.thumbnail_path] && json?.options_list 
                  ? json?.options_list[im.options_index ?? 0]?.nbPages ?? 0
                  : ((checkedRestrict && selectedItems.includes(im.thumbnail_path) ? scamOptionsSelected.nbPages: scamOptions.nbPages)) ?? (Number(scam_options.nb_pages_expected) ?? 0)
              )
            )
          )
        )  && (!image.checked || (expectedNumAnno && numAnno ? numAnno > expectedNumAnno : false))
      )
    }, [allScamData, checkedRestrict, json, scamOptions, scamOptionsSelected])

  const selectWithWarnings = useCallback((hasWarn = true) => {
    const postproc = (b:boolean|undefined) => hasWarn ? b : !b
    const selected = images.filter(im => postproc(calcHasWarning(im))
    ).map(im => im.thumbnail_path)
    setSelectedItems(selected)
  }, [selectedItems, allScamData, nbPages, images])

  const [scamQueue, setScamQueue] = useAtom(state.scamQueue)  

  const hasWarning:ScamImageData[] = (json?.files && Object.values(json.files).filter(im => calcHasWarning(im))) ?? [] 

  const [,setNumWarn] = useAtom(state.numWarn)

  useEffect(() => {
    setNumWarn(hasWarning.length)
  }, [hasWarning.length])

  const handleScamQueue = useCallback(async () => {    

    if(!scamQueue.todo?.length && json?.files && !go) {

      go = true
      abort = false

      let todo = json?.files.filter(m => (!m.checked || allScamData[m.thumbnail_path] && !allScamData[m.thumbnail_path].checked) && (!allScamData[m.thumbnail_path] || !allScamData[m.thumbnail_path]?.checked) && (!m.hidden || allScamData[m.thumbnail_path]?.visible))
      if(checkedRestrict) todo = todo.filter(m => selectedItems.includes(m.thumbnail_path))
      if(checkedRestrictWarning && hasWarning.length > 0) todo = todo.filter(m => hasWarning.find(im => im.thumbnail_path === m.thumbnail_path))

      //debug("sq:",todo, allScamData, hasWarning)

      const todoStr = todo.map(m => m.thumbnail_path)
      const done:string[] = []
      setScamQueue({ todo:todo.map(m => m.thumbnail_path), done })
      
      const handleSlice = async (list:ScamImageData[]) => {
        for(const image of list) {          
          if(unmount || abort) {
            setScamQueue({ todo: [], done: [] })
            break ;
          }          
          try {
                      
            const response = await axios.post(apiUrl + "run_scam_file", {
              folder_path: folder,
              scam_options: options,
              file_info: image
            }, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: "Basic " + encode(config.auth.join(":"))
              },
              //signal: controller.signal
            })
          
            debug("json:", response.data.thumbnail_path);
            
            if (response.data) {
              
              const state = 'new'
              const visible = !image.hidden
              const checked = image.checked
              const selected = selectedItems.includes(image.thumbnail_path)
                          
              dispatch({
                type: 'ADD_DATA',
                payload: {
                  id: image.thumbnail_path,
                  val: { data: response.data, state, time: Date.now(), image, visible, checked, options: selected ? { ...scamOptionsSelected}:{...scamOptions} } 
                }
              })                      
              
              // #9 always ungray save buttons after run_
              if(!modified) setModified(true)
              if(drafted) setDrafted(false)
              if(published) setPublished(false)
                          
              done.push(image.thumbnail_path)
              //debug("done:",done, scamQueue.todo)
              setScamQueue({ todo: todoStr, done })
              
            }        
          }
          catch(error:any) {
            if(error.message != "canceled") console.error(error);
          }
        }
        if(!todoStr.some(m => !done.includes(m))) {
          debug("end of run")
          setScamQueue({ todo: [], done: [] })
        }
      }

      
      const N_threads = 6;
      const chunks:ScamImageData[][] = [];
      for (let i = 0; i < N_threads; i ++) {
        chunks.push([])
      }
      for (let i = 0; i < todo.length; i ++) {
        chunks[i%N_threads].push(todo[i]);
      }
      chunks.map(handleSlice)      
        
    }
  }, [scamQueue.todo?.length, json?.files, checkedRestrict, checkedRestrictWarning, hasWarning, setScamQueue, allScamData, selectedItems, folder, options, config.auth, dispatch, scamOptionsSelected, scamOptions, modified, setModified, drafted, setDrafted, published])

  useEffect(() => {
    // not sure we should run without user interaction?
    //handleRerun()

    return () => {
      go = false
    }
  }, [])

  const progress = scamQueue.todo?.length && scamQueue.done 
    ? Math.round(100 * scamQueue.done.length / scamQueue.todo?.length)
    : 100

  const abortRun = () => {
    abort = true
  }

  const handleRerun = useCallback(() => {
    go = false

    setShouldRunAfter(Date.now()); 
    setShowSettings(false);  

    if(selectedItems.length > 0 && !checkedRestrict) setGlobalScamOptionsUpdate(true)    
    if(restrictRun != checkedRestrict) { 
      setRestrictRun(checkedRestrict)
      if(checkedRestrict) setTimeout(() => {
        setRestrictRun(false)
        setTimeout(() => {
          setOptions(scamOptionsSelected)          
        }, 150)
      }, 150)
    }

    setTimeout(() => {
      handleScamQueue()
    }, 350)
  }, [checkedRestrict, handleScamQueue, restrictRun, scamOptionsSelected, selectedItems, setGlobalScamOptionsUpdate, setOptions, setRestrictRun, setShouldRunAfter, setShowSettings])

  const [padding, setPadding] = useAtom(state.padding)

  useEffect(() => {
    if(grid === "mozaic") { 
      if(padding) setPadding(3)
    } else {
      if(padding !== state.defaultPadding) setPadding(state.defaultPadding)
    }
  }, [grid, padding])

  const [random, setRandom] = useAtom(state.random)
  const [outliar, setOutliar] = useAtom(state.outliar)

  const handleRandom = useCallback(() => {    
    if(typeof json == "object") {
      const n = json?.files.length
      const p = Math.floor(json?.files.length / 10)

      //const rand = _.orderBy(Array.from({length: p}, () => Math.floor(Math.random() * n)));      

      const arr:number[] = [], quantity = p, max = n
      while(arr.length < quantity){
        const candidateInt = Math.floor(Math.random() * max) 
        if(arr.indexOf(candidateInt) === -1) arr.push(candidateInt)
      }
      const randAll = Array.from(json?.files, (_:ScamImageData, i:number) => arr.includes(i))

      debug("rand:", _.orderBy(arr), randAll)

      setRandom(randAll)
    }
  }, [json, setRandom])

  const handleRotate = (angle:number) => {
    batchRotate(angle)
  }

  const handleOutliar = useCallback(() => {    
    const newOutliar = []
    let total = 0, n = 0
    for(let im of json?.files ?? []) {      
      if(allScamData[im.thumbnail_path]) im = allScamData[im.thumbnail_path].data 
      if(im?.pages) { 
        for(const p of im.pages) {
          if(!p.tags?.length) {
            total += p.minAreaRect[2] * p.minAreaRect[3]
            n++
          }
        }
      }
    }
    const med = total / n, maxMed = 1.5 * med, minMed = 0.75 * med
    let found 
    for(let im of json?.files ?? []) {      
      found = false
      if(allScamData[im.thumbnail_path]) im = allScamData[im.thumbnail_path].data 
      if(im?.pages) { 
        for(const p of im.pages) {
          if(!p.tags?.length) {
            const area = p.minAreaRect[2] * p.minAreaRect[3]
            if(area < minMed || area > maxMed) {
              newOutliar.push(true)
              found = true
              break
            }
          }
        }
      } 
      if(!found) newOutliar.push(false)
    } 
    setOutliar(newOutliar)
  }, [allScamData, json, setOutliar])

  const [loadThumbnails, setLoadThumbnails] = useAtom(state.loadThumbnails)
  const [brighten, setBrighten] = useAtom(state.brighten)
  const [contrast, setContrast] = useAtom(state.contrast)
  const [hideAnno, setHideAnno] = useAtom(state.hideAnno)

  const [clipboardWithCorner, setClipboardWithCorner] = useAtom(state.clipboardWithCorner)
  const [selectedRatio, setSelectedRatio ] = useAtom(state.selectedRatio) 
  const [keyDown, setKeyDown] = useAtom(state.keyDown)
  const [multiplePaste, setMultiplePaste] = useAtom(state.multiplePaste)

  useEffect(() => {
    if(multiplePaste) setMultiplePaste(false)
  }, [multiplePaste])

  const funcs:Record<string,()=>void> = useMemo(() => ({
    random:handleRandom,
    outliar:handleOutliar
  }), [handleRandom, handleOutliar])

  return (<nav className="bot">
    <Box sx={{ display:"flex", alignItems:"center" /*, minWidth:"250px"*/ }}>        
      { scamQueue.todo && scamQueue.todo.length > 0 && progress < 100 
        ? <div style={{ display:"flex", alignItems:"center" }}>
            <ColorButton onClick={abortRun} sx={{ margin:"10px" }}>abort run</ColorButton>
            <CircularProgressWithLabel value={progress} />
          </div> 
        : <ColorButton onClick={() => handleSettings()} disabled={scamQueue.todo?.length ? true : false} sx={{ margin: "10px" }}>
            Run scam...
          </ColorButton>
        }
    </Box>
    <Box>
      {/* <IconButton onClick={() => handleSettings()} disabled={scamQueue.todo?.length ? true : false} >
        <Settings />
      </IconButton> */}
      <TextField
        SelectProps={{ 
          MenuProps : { disableScrollLock: true }
        }}
        sx={{ minWidth: 100, marginLeft: "16px" }}
        select
        variant="standard"
        value={filter}
        label="Filter images"
        onChange={(r) => r.target.value != "load" ? setFilter(r.target.value) : null}
      >
        { ["all", "warning", "unchecked", "random", "outliar" ].map(f => <MenuItem value={f} {...funcs[f] ? {onClick:() => (funcs[f])()}:{}}>{f}</MenuItem>) }
      </TextField>
      <TextField
        SelectProps={{ 
          MenuProps : { disableScrollLock: true }
        }}
        sx={{ minWidth: 100, marginLeft: "16px" }}
        select
        variant="standard"
        value={grid}
        label="Display grid"
        onChange={(r) => setGrid(r.target.value)}
      >
        { ["1x1", "2x1", "3x2", "4x3", "5x3", "mozaic" ].map(f => <MenuItem value={f}>{f}</MenuItem>) }
      </TextField>
      <TextField
        SelectProps={{ 
          MenuProps : { disableScrollLock: true }
        }}
        sx={{ minWidth: 100, marginLeft: "16px" }}
        select
        variant="standard"
        value={0}
        label="Image selection"
      >
        <MenuItem value={0} disabled>{"..."}</MenuItem>
        <hr/>
        { hasWarning.length != 0 && <MenuItem value={1} onClick={() => selectWithWarnings(false)}>{"Select images with no warning"}</MenuItem> }
        { hasWarning.length != 0 && <MenuItem value={2} onClick={() => selectWithWarnings()}>{"Select images with warning"}</MenuItem> }
        <MenuItem value={3} onClick={() => setSelectedItems(images.map(im => im.thumbnail_path))}>{"Select all"}</MenuItem>
        <MenuItem value={4} onClick={handleDeselectAll}>{"Deselect all"}</MenuItem>
        <hr/>
        <MenuItem value={51} disabled={selectedRatio === 0} onClick={() => setKeyDown("CTRL+C")}>Copy annotation</MenuItem>
        <MenuItem value={52} disabled={!clipboardWithCorner} onClick={() => setKeyDown("CTRL+V")}>Paste in current image</MenuItem>
        <MenuItem value={53} disabled={!clipboardWithCorner || !selectedItems.length} onClick={() => {
          setKeyDown("CTRL+V")
          setMultiplePaste(true)
        }}>Paste in selected images</MenuItem>
        <hr/>
        { (hasUnchecked || !hasChecked) && <MenuItem value={2} disabled={!hasUnchecked} onClick={() => markChecked(true)}>{"Mark checked"}</MenuItem>}
        { hasChecked && <MenuItem value={3} onClick={() => markChecked(false)}>{"Mark unchecked"}</MenuItem>}
        { (hasVisible || !hasHidden) && <MenuItem value={4} disabled={!hasVisible} onClick={() => markHidden(true)}>{"Mark hidden"}</MenuItem>}
        { hasHidden && <MenuItem value={5} onClick={() => markHidden(false)}>{"Mark visible"}</MenuItem>}
        <hr/>
        <MenuItem value={41} disabled={!selectedItems.length} onClick={() => handleRotate(90)}>{"Rotate 90°"}</MenuItem>
        <MenuItem value={42} disabled={!selectedItems.length} onClick={() => handleRotate(180)}>{"Rotate 180°"}</MenuItem>
        <MenuItem value={43} disabled={!selectedItems.length} onClick={() => handleRotate(270)}>{"Rotate 270°"}</MenuItem>
        <hr/>
        <MenuItem value={4} disabled={!selectedItems.length} onClick={() => setShowSettings(true)}>{"Run SCAM on selection"}</MenuItem>
      </TextField>
      <TextField
        SelectProps={{ 
          MenuProps : { disableScrollLock: true }
        }}
        sx={{ minWidth: 100, marginLeft: "16px" }}
        select
        variant="standard"
        value={0}
        label="Thumbnails"
        onChange={(r) => r.target.value != "load" ? setFilter(r.target.value) : null}
      >
        <MenuItem value={0} disabled>{"..."}</MenuItem>
        <hr/>
        <Stack direction="row" alignItems="center" sx={{ mr:1, width: 199, margin:"16px" }} spacing={1.5} title="Brightness">
          <LightMode sx={{width:18}} />
          <Slider
            size="small"
            value={brighten}
            aria-label="Small"
            valueLabelDisplay="auto"
            min={-100} max={100} step={5} 
            onChange={(_,n) => setBrighten(n as number)}
          />
        </Stack>
        <Stack direction="row" alignItems="center" sx={{ mr:1, width: 199, margin:"16px"}} spacing={1.5} title="Contrast">
          <Contrast sx={{width:18}} />
          <Slider
            size="small"
            value={contrast}
            aria-label="Small"
            valueLabelDisplay="auto"
            min={-100} max={100} step={5} 
            onChange={(_,n) => setContrast(n as number)}
          />
        </Stack>
        <Stack>
          <FormControlLabel 
            sx={{margin:"0px 12px 4px 4px"}}
            label={"hide annotations"} 
            onChange={() => setHideAnno(!hideAnno)} 
            control={<Checkbox checked={hideAnno} sx={{padding: "0 8px" }}/>}  
          />
        </Stack>
        <hr/>
        <Stack>
          <FormControlLabel 
            sx={{margin:"4px 12px 4px 4px"}}
            label={"don't load thumbnails"} 
            onChange={() => setLoadThumbnails(!loadThumbnails)} 
            control={<Checkbox checked={!loadThumbnails} sx={{padding: "0 8px" }}/>}  
          />
        </Stack>
      </TextField>
    </Box>    
    <div>
      <SaveButtons {...{ drafts, progress, folder, config, json, setJson, selectedItems, checkedRestrict, hasWarning }} />
    </div>
    <Dialog open={showSettings} onClose={handleClose} disableScrollLock={true} >
      <DialogTitle>Run SCAM</DialogTitle>
      <DialogContent>
        {/* <DialogContentText>
          To subscribe to this website, please enter your email address here. We
          will send updates occasionally.
        </DialogContentText> */}
        <IconButton
          edge="end"
          color="inherit"
          onClick={handleClose}
          aria-label="close"
          style={{ position: 'absolute', top: 2, right: 14 }}
        >
          <Close />
        </IconButton>
        <SettingsMenu />
        <br/>
        <div>
          <FormControlLabel 
            disabled={hasWarning.length === 0}
            label={"only run on images with warning"} 
            onChange={() => setCheckedRestrictWarning(!checkedRestrictWarning)} 
            control={<Checkbox checked={hasWarning.length > 0 && checkedRestrictWarning} sx={{padding: "0 8px" }}/>}  
          />
        </div>
        <div>
          <FormControlLabel 
            disabled={!selectedItems.length}
            label={"only run on selected images"} 
            onChange={() => setCheckedRestrict(!checkedRestrict)} 
            control={<Checkbox checked={checkedRestrict} sx={{padding: "0 8px" }}/>}  
          />
        </div>
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleRerun} sx={{ textAlign: "right" }}>re-run SCAM on<br/>unchecked images</ColorButton>
        {/* <Button onClick={handleClose}>Close</Button> */}
      </DialogActions>
    </Dialog>
  </nav>)
}
