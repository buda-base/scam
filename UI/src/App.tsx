import { useCallback, useEffect, useState, useMemo } from 'react'
import axios from 'axios';
import debugFactory from "debug"
import { encode } from "js-base64"
import { ThemeProvider } from '@mui/material/styles';
import { useSearchParams } from "react-router-dom";

// tmp data
//import data from "./assets/scam.json"

import { ScamImageContainer } from "./components/ScamImage"
import './App.css'
import { ConfigData, LocalData, SavedScamData, ScamData, ScamImageData } from './types';
import { BottomBar } from './components/BottomBar';
import { TopBar } from './components/TopBar';
import { ColorButton, theme } from "./components/theme"
import { Close } from '@mui/icons-material';
import { Dialog, DialogTitle, DialogContent, IconButton, DialogActions, TextField } from '@mui/material';


const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData | boolean>(false)
  const [jsonPath, setJsonPath] = useState("")

  const [searchParams, setSearchParams] = useSearchParams({});
  const [ folder, setFolder ] = useState(searchParams.get("folder") || "");
  const [ error, setError ] = useState("")


  const [ drafts, setDrafts ] = useState(
    ( ( JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).drafts || {} ) [folder] || {}
  )

  const [loadDraft, setLoadDraft] = useState<boolean|undefined>(Object.keys(drafts).length ? undefined : false)


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

    debug("folder?",folder)

    if(config.auth &&  folder && (!json || typeof json === 'object' && jsonPath && (jsonPath != json?.folder_path) || folder != jsonPath)) { 

      if(!folder.endsWith("/")) { 
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
        debug("json",response.data);

        setJson(response.data)
        setSearchParams({ folder })
      })
      .catch(error => {
        console.error(error);
        
        setError(error.message)

        // use preloaded local data
        // setJson(data)
      });
    } else if(json && !folder) {
      setImages([])
      setJson(false)
    }
  }, [config, folder, json])

  useEffect( () => {
    if(typeof json === 'object' && json.files) setImages(json.files)
  }, [json])

  const setImageData = useCallback((data:ScamImageData) => {
    if(typeof json !== 'object') return
    const idx = json.files.findIndex((im) => im.thumbnail_path === data.thumbnail_path)
    debug("set:", data, data.thumbnail_path, idx)
    const newJson = { ...json }
    newJson.files[idx] = { ...data }
    setJson(newJson)
  }, [json])

  const handleClose = useCallback(async (discard?: boolean) => {
    setLoadDraft(false)
    if(discard) {
      const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
      if(local.drafts && local.drafts[folder]) delete local.drafts[folder] 
      localStorage.setItem("scamUI", JSON.stringify(local))
    }
  }, [folder])

  const handleLoad = () => {
    setLoadDraft(true)
  }

  
  useEffect(() => {
    setError("")
  }, [folder])
  
  
  useEffect(() => {
    if(typeof json === 'object' && jsonPath != json.folder_path) setJsonPath(json.folder_path)
  }, [json, jsonPath])
  

  useEffect(() => {
    if(loadDraft && drafts) {
      Object.values(drafts).map(v => setImageData(v.image))
    }
  }, [loadDraft, drafts])

  const reloadDialog = useMemo(() => (
    <Dialog open={loadDraft === undefined && Object.keys(drafts).length ? true : false} onClose={() => handleClose()} disableScrollLock={true} >
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
  
  return (
    <ThemeProvider theme={theme}>
      {reloadDialog}
      <header className={"folder-empty-"+(folder === "" || error != "" && !json)}><TopBar {...{ folder, error, jsonPath, setFolder }}/></header>
      <main>{json && images.map(image => <ScamImageContainer {...{ folder, image, config, loadDraft, draft: drafts[image.thumbnail_path], setImageData }}/>)}</main>
      { json && <footer><BottomBar {...{ folder, setFolder }}/></footer>}
    </ThemeProvider>
  )
}

export default App
