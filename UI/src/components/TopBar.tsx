
import { Dialog, DialogTitle, DialogContent, TextField, DialogActions, IconButton } from "@mui/material";
import debugFactory from "debug"
import { useState, useMemo, MouseEventHandler, useCallback, ChangeEventHandler, useEffect, KeyboardEventHandler } from "react";
import { useNavigate } from "react-router-dom";

import { ColorButton } from "./theme";
import { Close, Folder, FolderOpen } from "@mui/icons-material";

const debug = debugFactory("scam:bbar")

export const TopBar = (props: { folder:string, error: string, jsonPath:string, setFolder:(s:string) => void }) => {
  const { folder, error, jsonPath, setFolder } = props;

  const [ path, setPath ] = useState(folder)
  
  const [ showDialog, setShowDialog ] = useState(false)
  
  const handleOpen = useCallback(() => {
    if(!jsonPath.match(new RegExp("^"+path+"/?$")) || error) {
      setFolder(path)
      if(showDialog) setShowDialog(false)
    }
    else if(showDialog) setShowDialog(false)
    else setFolder(path)
  },[error, jsonPath, path, setFolder, showDialog])

  const handlePath: ChangeEventHandler<HTMLInputElement> = useCallback((e) => {
    setPath(e.currentTarget.value)
  },[ setPath ])

  const handleClose = useCallback(() => {
    if(showDialog) setShowDialog(false)
  }, [showDialog])

  const couldHandleOpen:KeyboardEventHandler = useCallback((e) => {
    if(e.code == "Enter") handleOpen()
  }, [handleOpen])

  const handleDialog = useCallback(() => {
    setShowDialog(true)
  }, [])

  const navigate = useNavigate();
  const handleNav = () => {
    setFolder("")
    navigate("/")
  }
  
  useEffect( () => {
    if(jsonPath) setPath(jsonPath)
  }, [jsonPath])

  debug(folder, error, jsonPath, showDialog)

  const folderDialog = useMemo(() => (
    <Dialog open={folder == "" || error != "" || showDialog} onClose={handleClose} disableScrollLock={true} hideBackdrop={!showDialog || folder != jsonPath}>
      <DialogTitle>Choose folder</DialogTitle>
      <DialogContent>
        { (showDialog && folder == jsonPath) && 
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
            style={{ position: 'absolute', top: 2, right: 14 }}
          >
            <Close />
          </IconButton> }
        <TextField
          variant="standard"
          value={path}
          label="New path"
          InputLabelProps={{ shrink: true }}
          error={error ? true : false}
          helperText={error ? <>Could't open '{folder}':<br/><i>{error}</i></> : ""}
          onChange={handlePath}
          onKeyDown={couldHandleOpen}
        />
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleOpen} /*disabled={path == folder}*/>Open</ColorButton>
      </DialogActions>
    </Dialog>
    ), [folder, error, showDialog, handleClose, path, handlePath, couldHandleOpen, handleOpen])
  
  return <nav className="top">
    {folderDialog}
    <div></div>
    <div className="nav">
    { folder && <>
        <div onClick={handleDialog}>
          <IconButton sx={{color:"black"}}>
            <FolderOpen />
          </IconButton>
          <span>{jsonPath}</span>
        </div>
        <IconButton sx={{color:"black"}} onClick={handleNav}> 
          <Close />
        </IconButton>
      </>}
    </div>
  </nav>
}