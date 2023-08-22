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
  DialogTitle,
} from '@mui/material';
import { useAtom } from "jotai";
import debugFactory from "debug"
import { encode } from "js-base64";

import { ConfigData, LocalData, Page, SavedScamData, ScamData, ScamOptionsMap } from "../types"
import SettingsMenu from "./SettingsMenu";
import * as state from "../state"
import { ColorButton } from "./theme"
import { apiUrl, discardDraft } from "../App";
import axios from "axios";
import { withoutRotatedHandle } from "./ScamImage";

const debug = debugFactory("scam:bbar")

export const SaveButtons = (props: { folder: string, config: ConfigData, json?:ScamData, onConfirmed?:() => void }) => {
  const { folder, json, config, onConfirmed } = props;

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)

  const [modified, setModified] = useAtom(state.modified)
  const [published, setPublished] = useState(false)
  const [drafted, setDrafted] = useAtom(state.drafted)

  const [orient, setOrient] = useAtom(state.orientAtom)
  const [direc, setDirec] = useAtom(state.direcAtom)
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)

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

  const scamOptions:ScamOptionsMap = useMemo(() => ({
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

  const saveDraft = useCallback(async () => {
    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    if(!local.drafts) local.drafts = {}
    local.drafts[folder] = { 
      ...local.drafts[folder], 
      images: { ...Object.keys(allScamData).reduce( (acc,a) => {
        const val = allScamData[a]
        val.data = { ...val.data }
        if(["draft", "modified"].includes(val.state)) { 
          if(val.data.pages) val.data.pages = val.data.pages.map(withoutRotatedHandle) as Page[]
          return ({ ...acc, [a]: val })
        }
        return acc
      }, {}) },
      options: orient != "custom" ? { orientation: orient } : { ...scamOptions }
    }
    localStorage.setItem("scamUI", JSON.stringify(local))
    //setModified(false)
    setDrafted(true)
    if(onConfirmed) onConfirmed()
  }, [allScamData, folder, onConfirmed, orient, scamOptions])

  const publish = useCallback(async () => {
    
    setSaving(true)

    const toSave = { 
      ...json, 
      files: json?.files.map(j => {
        const obj = allScamData[j.thumbnail_path] || {}
        let data = { 
          ...j,
          ...obj.data || {}
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
      checked
    }
    
    debug("publish", json, allScamData, toSave)

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
      debug("json",response.data);

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
        <div className="popper-bg-bar"></div>
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

export const BottomBar = (props: { folder:string, config: ConfigData, json?:ScamData,  }) => {
  const { folder, config, json } = props;

  const [showSettings, setShowSettings] = useState(false)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const handleClose = () => { setShowSettings(false); };

  const handleRun = () => { setShouldRunAfter(Date.now()); setShowSettings(false);  };
  
  useEffect( () =>  {

    debug("data:",allScamData)

  }, [allScamData])
  

  const [filter, setFilter] = useAtom(state.filter)

  return (<nav className="bot">
    <Box>
      <IconButton onClick={() => setShowSettings(true)}>
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
    </Box>
    <div>
      <SaveButtons {...{ folder, config, json }} />
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
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleRun} sx={{ textAlign: "right" }}>re-run SCAM on<br/>unchecked images</ColorButton>
        {/* <Button onClick={handleClose}>Close</Button> */}
      </DialogActions>
    </Dialog>
  </nav>)
}
