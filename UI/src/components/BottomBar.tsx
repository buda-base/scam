import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, Button, ButtonProps, Popover, FormControlLabel, Checkbox, Popper, Paper } from "@mui/material"
import { ChangeEvent, ChangeEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Settings, Close } from '@mui/icons-material';
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
import { apiUrl, discardDraft } from "../App";
import axios from "axios";
import { withoutRotatedHandle } from "./ScamImage";

const debug = debugFactory("scam:bbar")

export const SaveButtons = (props: { folder: string, config: ConfigData, json?:ScamData, selectedItems:string[], checkedRestrict: boolean }) => {
  const { folder, json, config, selectedItems, checkedRestrict } = props;

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)

  const [modified, setModified] = useAtom(state.modified)
  const [published, setPublished] = useState(false)
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

  const [popChecked, setPopChecked] = useState(false)
  const [checked, setChecked] = useState(false)
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
    const opts:ScamOptions = { orient, ...orient === "custom" ? { direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed }:{} }
    //debug("opts!", opts, selectedItems.length, globalScamOptionsUpdate, checkedRestrict)
    if(selectedItems.length > 0 && !checkedRestrict || !selectedItems.length || globalScamOptionsUpdate) setScamOptions(opts)
    else setScamOptionsSelected(opts)    
    if(globalScamOptionsUpdate != false) setGlobalScamOptionsUpdate(false)

    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    local.options = { orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed }
    localStorage.setItem("scamUI", JSON.stringify(local))

  }, [orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, selectedItems.length, checkedRestrict, globalScamOptionsUpdate, 
      setScamOptions, setScamOptionsSelected, setGlobalScamOptionsUpdate])   
    
  useEffect(() => {
    updateOptions()
  },[ orient, direc, minRatio, maxRatio, nbPages, minAreaRatio, maxAreaRatio, minSquarish, fixedWidth, fixedHeight, cutAtFixed, selectedItems, globalScamOptionsUpdate])

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
    local.drafts[folder] = { 
      ...local.drafts[folder], 
      images: { ...Object.keys(allScamData).reduce( (acc,a) => {
        const val = allScamData[a]
        val.data = { ...val.data }
        if(["draft", "modified", "uploaded"].includes(val.state)) { 
          if(val.data.pages) val.data.pages = val.data.pages.map(withoutRotatedHandle) as Page[]
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

  const publish = useCallback(async () => {
    
    setSaving(true)
    
    const configs:ScamOptions[] = [{ ...scamOptions }]
    const toSave = { 
      ...json, 
      files: json?.files.map(j => {
        const obj = allScamData[j.thumbnail_path] || {}
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
        if(data.hidden) delete data.hidden
        if(data.checked) delete data.checked
        data = { 
          ...data,
          ...obj.visible == false ? { hidden: true }  : {},
          ...obj.checked ? { checked: true } : {}
        }
        if(data.rects) delete data.rects
        if(data.pages) data.pages = data.pages.map(withoutRotatedHandle) as Page[]
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
    })
    .catch(error => {
      debug(error, json);
      
      setSaving(false)
      setError(error.message)

    });

    
  }, [allScamData, checked, config.auth, folder, json, setModified])

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
            ? <FormControlLabel control={<Checkbox checked={checked} onChange={handleChecked}/>} label="ready to be processed" /> 
            : <>Failed to save<br/>(<i>{error}</i>)</> }
        </Paper>
      </Popper>
      <ColorButton onClick={saveDraft} disabled={!modified || drafted || popChecked}>save draft</ColorButton>
      <span ref={spanRef}>
        <ColorButton className={saving?"saving":""} sx={{ marginLeft:"8px" }} onClick={handlePublish} disabled={!modified || published || !config.auth ||  saving}>{ 
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

export const BottomBar = (props: { folder:string, config: ConfigData, json?:ScamData, selectedItems:string[], images: ScamImageData[],
    setSelectedItems:(i:string[]) => void, markChecked:(b:boolean) => void, markHidden:(b:boolean) => void, setOptions:(opt:ScamOptions) => void  }) => {
  const { folder, config, json, selectedItems, images, setSelectedItems, markChecked, markHidden, setOptions } = props;

  const [showSettings, setShowSettings] = useAtom(state.showSettings)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [restrictRun, setRestrictRun] = useAtom(state.restrictRun)
  const [checkedRestrict, setCheckedRestrict] = useAtom(state.checkedRestrict)

  const [globalScamOptionsUpdate, setGlobalScamOptionsUpdate] = useAtom(state.globalScamOptionsUpdate)

  const handleClose = () => { 
    setShowSettings(false); 
  };

  const [scamOptions, setScamOptions] = useAtom(state.scamOptions)

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
   
  const [filter, setFilter] = useAtom(state.filter)
  const [grid, setGrid] = useAtom(state.grid)
  useEffect(() => {
    const restoreGrid = async () => {
      const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
      if(local.grid) setGrid(local.grid)
    }
    restoreGrid()
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

  const selectWithWarnings = useCallback(() => {
    const selected = images.filter(im => ( allScamData[im.thumbnail_path]?.data?.rects && (
        allScamData[im.thumbnail_path]?.data?.rects?.some(p => p.warning) 
        || allScamData[im.thumbnail_path]?.data?.rects?.length != (allScamData[im.thumbnail_path]?.options?.nbPages || nbPages)
      )
    )).map(im => im.thumbnail_path)
    setSelectedItems(selected)
  }, [selectedItems, allScamData, nbPages])

  return (<nav className="bot">
    <Box>
      <IconButton onClick={() => handleSettings()}>
        <Settings />
      </IconButton>
      <TextField
        SelectProps={{ 
          MenuProps : { disableScrollLock: true }
        }}
        sx={{ minWidth: 100, marginLeft: "16px" }}
        select
        variant="standard"
        value={filter}
        label="Filter images"
        onChange={(r) => setFilter(r.target.value)}
      >
        { ["all", "warning", "unchecked" ].map(f => <MenuItem value={f}>{f}</MenuItem>) }
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
        { ["1x1", "2x1", "3x2", "4x3" ].map(f => <MenuItem value={f}>{f}</MenuItem>) }
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
        <MenuItem value={1} onClick={selectWithWarnings}>{"Select images with warning"}</MenuItem>
        <MenuItem value={1} onClick={() => setSelectedItems(images.map(im => im.thumbnail_path))}>{"Select all"}</MenuItem>
        <MenuItem value={1} onClick={handleDeselectAll}>{"Deselect all"}</MenuItem>
        <hr/>
        { (hasUnchecked || !hasChecked) && <MenuItem value={2} disabled={!hasUnchecked} onClick={() => markChecked(true)}>{"Mark checked"}</MenuItem>}
        { hasChecked && <MenuItem value={3} onClick={() => markChecked(false)}>{"Mark unchecked"}</MenuItem>}
        { (hasVisible || !hasHidden) && <MenuItem value={4} disabled={!hasVisible} onClick={() => markHidden(true)}>{"Mark hidden"}</MenuItem>}
        { hasHidden && <MenuItem value={5} onClick={() => markHidden(false)}>{"Mark visible"}</MenuItem>}
        <hr/>
        <MenuItem value={4} disabled={!selectedItems.length} onClick={() => setShowSettings(true)}>{"Run SCAM on selection"}</MenuItem>
      </TextField>
    </Box>
    <div>
      <SaveButtons {...{ folder, config, json, selectedItems, checkedRestrict }} />
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
        <br/>
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
        <ColorButton onClick={handleRun} sx={{ textAlign: "right" }}>re-run SCAM on<br/>unchecked images</ColorButton>
        {/* <Button onClick={handleClose}>Close</Button> */}
      </DialogActions>
    </Dialog>
  </nav>)
}
