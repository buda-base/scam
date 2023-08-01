import { useCallback, useEffect, useState } from 'react'
import axios from 'axios';
import debugFactory from "debug"
import { encode } from "js-base64"
import { ThemeProvider } from '@mui/material/styles';

// tmp data
//import data from "./assets/scam.json"

import { ScamImageContainer } from "./components/ScamImage"
import './App.css'
import { ConfigData, LocalData, SavedScamData, ScamData, ScamImageData } from './types';
import BottomBar from './components/BottomBar';
import { ColorButton, theme } from "./components/theme"
import { Close } from '@mui/icons-material';
import { Dialog, DialogTitle, DialogContent, IconButton, DialogActions } from '@mui/material';
import SettingsMenu from './components/SettingsMenu';
 
const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData | boolean>(false)

  const [ folder, setFolder] = useState("Bruno/Reruk/");

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
    if(config.auth && !json) { 
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
      })
      .catch(error => {
        console.error(error);

        // use preloaded local data
        // setJson(data)
      });
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

  const handleClose = async (discard?: boolean) => {
    setLoadDraft(false)
    if(discard) {
      const local: LocalData = await JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData
      if(local.drafts && local.drafts[folder]) delete local.drafts[folder] 
      localStorage.setItem("scamUI", JSON.stringify(local))
    }
  }

  const handleLoad = () => {
    setLoadDraft(true)
  }

  return (
    <ThemeProvider theme={theme}>
      <Dialog open={loadDraft === undefined && Object.keys(drafts).length ? true : false} onClose={() => handleClose()} disableScrollLock={true}>
        <DialogTitle>Draft found</DialogTitle>
        <DialogContent>
          Load previous edits for '{folder}'?
          {/* <DialogContentText>
            To subscribe to this website, please enter your email address here. We
            will send updates occasionally.
          </DialogContentText> */}
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
          <ColorButton onClick={() => handleClose(true)} >Discard</ColorButton>
          <ColorButton onClick={handleLoad} >Load</ColorButton>
        </DialogActions>
      </Dialog>
      <header></header>
      <main>{images.map(image => <ScamImageContainer {...{ folder, image, config, loadDraft, draft: drafts[image.thumbnail_path]?.data, setImageData }}/>)}</main>
      <footer><BottomBar {...{ folder }}/></footer>
    </ThemeProvider>
  )
}

export default App
