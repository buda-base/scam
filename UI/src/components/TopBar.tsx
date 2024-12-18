
import { Dialog, DialogTitle, DialogContent, TextField, DialogActions, IconButton, Button, FormLabel, InputLabel, useTheme } from "@mui/material";
import debugFactory from "debug"
import { useState, useMemo, MouseEventHandler, useCallback, ChangeEventHandler, useEffect, KeyboardEventHandler } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { useBeforeunload } from 'react-beforeunload';
import { CheckCircle, Close, Folder, FolderOpen } from "@mui/icons-material";
import { useClearCache } from "react-clear-cache"

import { ColorButton } from "./theme";
import * as state from "../state"
import { SaveButtons } from "./BottomBar";
import { ConfigData, LocalData, ScamData, ScamImageData } from "../types";

const debug = debugFactory("scam:tbar")

export const TopBar = (props: { images:ScamImageData[], folder:string, config: ConfigData, error: string, json:ScamData|boolean, jsonPath:string, setFolder:(s:string) => void }) => {
  const { images, folder, config, error, json, jsonPath, setFolder } = props;

  const [ path, setPath ] = useState(folder)
  
  const [ showDialog, setShowDialog ] = useState(false)
  const [ confirmAct, setConfirmAct ] = useState<boolean|undefined>(undefined)

  const [modified, setModified] = useAtom(state.modified)
  const [drafted, setDrafted] = useAtom(state.drafted)
  const [published, setPublished] = useAtom(state.published)
    
  const theme = useTheme()
  
  const navigate = useNavigate();

  const { latestVersion, isLatestVersion, emptyCacheStorage } = useClearCache()

  const [sessions, setSessions] = useState<string[]>([])

  useEffect(() => {
    const hasSessions = Object.keys(((JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).sessions || {} ))
    setSessions(hasSessions)
  }, [])

  const handleOpen = useCallback(() => {    
    if(!jsonPath.match(new RegExp("^"+path+"/?$")) || error) {
      navigate("/?folder="+path)      
      if(showDialog) setShowDialog(false)
    }
    else if(showDialog) setShowDialog(false)
    else {
      navigate("/?folder="+path)      
    }
  },[error, jsonPath, path, setFolder, showDialog, navigate])

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

  const handleNav = useCallback(() => {
    setFolder("")
    navigate("/")
  }, [navigate, setFolder])
  
  const [proceed, setProceed] = useState(false)
  
  useEffect( () => {
    if(jsonPath) { 
      setPath(jsonPath)    
      setProceed(false)
    }
  }, [jsonPath])

  const handleConfirm = useCallback( (leave: boolean) => {

    debug("cf:", leave, modified, drafted, published)

    if(modified && !drafted) {
      setConfirmAct(leave)
    } else {
      if(leave) handleNav()
      else handleDialog()
    }
  }, [handleDialog, handleNav, modified, drafted, published])
  
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
    <Dialog open={folder != "" && confirmAct != undefined && !showDialog} disableScrollLock={true} >
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
          Lose your changes to '{folder}'?
        </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleClose}>Cancel</ColorButton>
        <ColorButton onClick={onConfirmed}>Ok</ColorButton>
        {/* <SaveButtons { ...{ folder, config, onConfirmed }}/> */}
      </DialogActions>
    </Dialog>
  ), [config, confirmAct, folder, drafted, published, handleClose, modified, onConfirmed, showDialog])

  //debug("tb:",confirmAct, modified, folder, error, showDialog)

  const readyDialog = useMemo(() => (
    <Dialog open={typeof json === "object" && json.checked && json.checked != "local" && !proceed}  disableScrollLock={true} >     
      <DialogTitle>Warning</DialogTitle>
      <DialogContent>
        <IconButton
          edge="end"
          color="inherit"
          onClick={() => setProceed(true)}
          aria-label="close"
          style={{ position: 'absolute', top: 2, right: 14 }}
        >
          <Close />
        </IconButton>
        This folder has already been marked as ready to process
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleNav}>Cancel</ColorButton>
        <ColorButton onClick={() => setProceed(true)}>Proceed anyway</ColorButton>
      </DialogActions>
    </Dialog>
  ), [handleNav, json, proceed])

  const folderDialog = useMemo(() => (
    <Dialog open={(!folder || confirmAct == false || !modified || drafted) && (folder == "" || error != "" || showDialog)} onClose={handleClose} disableScrollLock={true} hideBackdrop={!showDialog || folder != jsonPath}>
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
            <div style={{ maxHeight:"250px", overflow:"auto" }}>
            { sessions.map(s => <Button sx={{ fontSize:16, textTransform: "none", padding:"0px 8px", display:"flex" }}>
                <Link style={{color:theme.palette.primary.main}} to={"/?folder="+s} onClick={handleClose}>{s}</Link>
              </Button>)}
            </div>
          </div>
        </div> }
      </DialogContent>
      <DialogActions sx={{padding:"16px"}}>
        <ColorButton onClick={handleOpen} /*disabled={path == folder}*/>Open</ColorButton>
      </DialogActions>
    </Dialog>
    ), [confirmAct, modified, folder, error, showDialog, handleClose, jsonPath, path, handlePath, couldHandleOpen, sessions, handleOpen, theme.palette.primary.main])
  
  const handleUpdate = (e: { preventDefault: () => void; }) => {
    e.preventDefault();
    emptyCacheStorage();
  }
  
  const [numWarn] = useAtom(state.numWarn)

  const [allScamData, ] = useAtom(state.allScamDataAtom)

  const numNotDone = images.filter(im => allScamData[im.thumbnail_path]?.data ? !allScamData[im.thumbnail_path].data.pages : !im.pages).length

  //debug("nnd:",numNotDone, images, allScamData)

  return <nav className="top">
    {readyDialog}
    {confirmDialog}
    {folderDialog}
    <div style={{ fontWeight:600, color:"#000", cursor:"pointer" }} onClick={() => handleConfirm(true)}>SCAM QC</div> 
    <div style={{ marginRight: "auto", marginLeft:20 }}>
      { isLatestVersion 
        ? <span title={latestVersion} style={{ fontSize: 12, verticalAlign: 2 }}>(up-to-date)</span>
        : <ColorButton onClick={handleUpdate}>Update Scam QC</ColorButton>
      }
    </div>
    <div className="nav">
    { folder && <>
        <div style={{ display:"flex", alignItems:"center" }} onClick={() => handleConfirm(false)}>
          <IconButton sx={{color:"black"}}>
            <FolderOpen />
          </IconButton>
          <div>
            <div>{jsonPath}</div>
            {typeof json === "object" && <div style={{color:"#6b6b6b"}}>
               {json.files?.length} images { !numWarn ? <> | No warning</> : <> | {numWarn} warning{numWarn > 1 ? "s" : ""}</>} | {numNotDone ? numNotDone + " files not done": "All files done"}
              { json.checked && <span title="already marked as ready to process"><CheckCircle sx={{color:"green", verticalAlign:"-8px", marginLeft:"10px"}} /></span> }
            </div> }
          </div>
        </div>
        <IconButton sx={{color:"black"}} onClick={() => handleConfirm(true)}> 
          <Close />
        </IconButton>
      </>}
    </div>
  </nav>
}