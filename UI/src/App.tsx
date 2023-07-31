import { useEffect, useState } from 'react'
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
import { theme } from "./components/theme"
 
const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData | boolean>(false)

  const [ folder, setFolder] = useState("Bruno/Reruk/");

  const [ drafts ] = useState(
    ( ( JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).drafts || {} ) [folder] || {}
  )

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

  return (
    <ThemeProvider theme={theme}>
      <header></header>
      <main>{images.map(image => <ScamImageContainer {...{ folder, image, config, draft: drafts[image.thumbnail_path]?.data }}/>)}</main>
      <footer><BottomBar {...{ folder }}/></footer>
    </ThemeProvider>
  )
}

export default App
