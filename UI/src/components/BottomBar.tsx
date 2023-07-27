import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, Button } from "@mui/material"
import { useState } from "react"
import { Settings, Close } from '@mui/icons-material';
import {
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useAtom } from "jotai";

import SettingsMenu from "./SettingsMenu";
import * as state from "../state"

const BottomBar = (props: { /*folder:string, image: ScamImageData, config: ConfigData*/ }) => {
  //const { folder, config, image } = props;

  const [showSettings, setShowSettings] = useState(false)
  const theme = useTheme()

  const [shouldRunAfter, setShouldRunAfter] = useAtom(state.shouldRunAfterAtom)

  const handleClose = () => { setShowSettings(false); };

  const handleRun = () => { setShouldRunAfter(Date.now()) };


  return (<nav className="bot">
    <IconButton onClick={() => setShowSettings(true)}>
      <Settings />
    </IconButton>
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
      <DialogActions>
        <Button onClick={handleRun} sx={{ textAlign: "right" }}>re-run SCAM on<br/>unchecked images</Button>
        {/* <Button onClick={handleClose}>Close</Button> */}
      </DialogActions>
    </Dialog>
  </nav>)
}

export default BottomBar