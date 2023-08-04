import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, Button, ButtonProps } from "@mui/material"
import { useCallback, useEffect, useMemo, useState } from "react"
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

import { LocalData, SavedScamData, ScamOptionsMap } from "../types"
import SettingsMenu from "./SettingsMenu";
import * as state from "../state"
import { ColorButton } from "./theme"

const debug = debugFactory("scam:bbar")

export const BottomBar = (props: { folder:string }) => {
  const { folder } = props;

  const [showSettings, setShowSettings] = useState(false)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [modified, setModified] = useAtom(state.modified)

  const handleClose = () => { setShowSettings(false); };

  const handleRun = () => { setShouldRunAfter(Date.now()); setShowSettings(false);  };

  const [orient, setOrient] = useAtom(state.orientAtom)
  const [direc, setDirec] = useAtom(state.direcAtom)
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)

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
        if(["draft", "modified"].includes(val.state)) return ({ ...acc, [a]: val })
        return acc
      }, {}) },
      options: orient != "custom" ? { orientation: orient } : { ...scamOptions }
    }
    localStorage.setItem("scamUI", JSON.stringify(local))
    setModified(false)
  }, [allScamData, folder, scamOptions, setModified])

  
  useEffect( () =>  {

    debug("data:",allScamData)

  }, [allScamData])
  

  return (<nav className="bot">
    <IconButton onClick={() => setShowSettings(true)}>
      <Settings />
    </IconButton>
    <div>
      <ColorButton onClick={() => saveDraft()} disabled={!modified}>save draft</ColorButton>
      <ColorButton sx={{ marginLeft:"8px" }} /*onClick={() => setShowSettings(true)}*/ disabled>publish</ColorButton>
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
