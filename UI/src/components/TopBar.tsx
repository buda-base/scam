
import { Dialog, DialogTitle, DialogContent, TextField, DialogActions, IconButton, Button, FormLabel, InputLabel, useTheme } from "@mui/material";
import debugFactory from "debug"
import { useState, useMemo, MouseEventHandler, useCallback, ChangeEventHandler, useEffect, KeyboardEventHandler } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { useBeforeunload } from 'react-beforeunload';

import { ColorButton } from "./theme";
import { Close, Folder, FolderOpen } from "@mui/icons-material";
import * as state from "../state"
import { SaveButtons } from "./BottomBar";
import { ConfigData, LocalData } from "../types";

const debug = debugFactory("scam:tbar")

export const TopBar = (props: { folder:string, config: ConfigData, error: string, jsonPath:string, setFolder:(s:string) => void }) => {
  const { folder, config, error, jsonPath, setFolder } = props;

  const [ path, setPath ] = useState(folder)
  
  const [ showDialog, setShowDialog ] = useState(false)
  const [ confirmAct, setConfirmAct ] = useState<boolean|undefined>(undefined)

  const [modified, setModified] = useAtom(state.modified)
  const [drafted, setDrafted] = useAtom(state.drafted)
    
  const theme = useTheme()
  
  const [sessions, setSessions] = useState<string[]>([])

  useEffect(() => {
    const hasSessions = Object.keys(((JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).sessions || {} ))
    setSessions(hasSessions)
  }, [])

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
    if(confirmAct != undefined) setConfirmAct(undefined)
  }, [confirmAct, showDialog])

  const couldHandleOpen:KeyboardEventHandler = useCallback((e) => {
    if(e.code == "Enter") handleOpen()
  }, [handleOpen])

  const handleDialog = useCallback(() => {
    setShowDialog(true)
  }, [])

  const navigate = useNavigate();
  const handleNav = useCallback(() => {
    setFolder("")
    navigate("/")
  }, [navigate, setFolder])
  
  useEffect( () => {
    if(jsonPath) setPath(jsonPath)
  }, [jsonPath])

  const handleConfirm = useCallback( (leave: boolean) => {
    if(modified) {
      setConfirmAct(leave)
    } else {
      if(leave) handleNav()
      else handleDialog()
    }
  }, [handleDialog, handleNav, modified])
  
  const onConfirmed = useCallback(()=> {
    if(confirmAct) handleNav()
    else handleDialog()
  }, [confirmAct, handleDialog, handleNav])

  //debug(folder, error, jsonPath, showDialog, confirmAct)
  
  const unload = useCallback((event:Event) => {
    if(modified && !drafted) { 
      event.preventDefault()
    }
  }, [modified, drafted])
  useBeforeunload(unload);

  const confirmDialog = useMemo( () => (
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    <Dialog open={modified && confirmAct != undefined && !showDialog} disableScrollLock={true} >
      <DialogTitle>Folder modified</DialogTitle>
      <DialogContent>
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
            style={{ position: 'absolute', top: 2, right: 14 }}
          >
            <Close />
          </IconButton> 
          Save changes to '{folder}'?
        </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleClose}>Cancel</ColorButton>
        <ColorButton onClick={onConfirmed}>No</ColorButton>
        <SaveButtons { ...{ folder, config, onConfirmed }}/>
      </DialogActions>
    </Dialog>
  ), [config, confirmAct, folder, handleClose, modified, onConfirmed, showDialog])

  const folderDialog = useMemo(() => (
    <Dialog open={(confirmAct == false || !modified) && (folder == "" || error != "" || showDialog)} onClose={handleClose} disableScrollLock={true} hideBackdrop={!showDialog || folder != jsonPath}>
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
          sx={{ width:"100%", minWidth:"90px" }}
        />
        { sessions.length > 0 && <div style={{ marginTop:16 }}>
          <InputLabel shrink={true}>Previously open folders</InputLabel>
          <div style={{ marginLeft: -9, marginTop:-4 }}>
            { sessions.map(s => <Button sx={{ fontSize:16, textTransform: "none", padding:"0px 8px" }}>
                <Link style={{color:theme.palette.primary.main}} to={"/?folder="+s} onClick={handleClose}>{s}</Link>
              </Button>)}
            </div>
        </div> }
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleOpen} /*disabled={path == folder}*/>Open</ColorButton>
      </DialogActions>
    </Dialog>
    ), [confirmAct, modified, folder, error, showDialog, handleClose, jsonPath, path, handlePath, couldHandleOpen, sessions, handleOpen, theme.palette.primary.main])
  
  return <nav className="top">
    {confirmDialog}
    {folderDialog}
    <div><Link to={"/"} style={{ fontWeight:600, color:"#000" }}>SCAM QC</Link></div>
    <div className="nav">
    { folder && <>
        <div onClick={() => handleConfirm(false)}>
          <IconButton sx={{color:"black"}}>
            <FolderOpen />
          </IconButton>
          <span>{jsonPath}</span>
        </div>
        <IconButton sx={{color:"black"}} onClick={() => handleConfirm(true)}> 
          <Close />
        </IconButton>
      </>}
    </div>
  </nav>
}