import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, Button, ButtonProps } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
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

import { LocalData, SavedScamData } from "../types"
import SettingsMenu from "./SettingsMenu";
import * as state from "../state"
import { ColorButton } from "./theme"

const debug = debugFactory("scam:bbar")

const BottomBar = (props: { folder:string /*, image: ScamImageData, config: ConfigData*/ }) => {
  const { folder } = props;

  const [showSettings, setShowSettings] = useState(false)

  const [allScamData, dispatch] = useAtom(state.allScamDataAtom)
  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const [modified, setModified] = useAtom(state.modified)

  const handleClose = () => { setShowSettings(false); };

  const handleRun = () => { setShouldRunAfter(Date.now()); setShowSettings(false);  };

  const saveDraft = useCallback(async () => {
    const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
    if(!local.drafts) local.drafts = {}
    local.drafts[folder] = { ...local.drafts[folder], ...Object.keys(allScamData).reduce( (acc,a) => {
      const val = allScamData[a]
      if(["draft", "modified"].includes(val.state)) return ({ ...acc, [a]: val })
      return acc
    }, {}) }
    localStorage.setItem("scamUI", JSON.stringify(local))
    setModified(false)
  }, [allScamData, folder])

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
    <Dialog open={showSettings} onClose={handleClose} disableScrollLock={true}>
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

export default BottomBar