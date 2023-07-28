import { useEffect, useState } from 'react'
import axios from 'axios';
import debugFactory from "debug"
import { encode } from "js-base64"

// tmp data
//import data from "./assets/scam.json"

import { ScamImageContainer } from "./components/ScamImage"
import './App.css'
import { ConfigData, ScamData, ScamImageData } from './types';
import BottomBar from './components/BottomBar';

const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData | boolean>(false)

  const [ folder, setFolder] = useState("Bruno/Reruk/");

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

  return (<>
    <header></header>
    <main>{images.map(image => <ScamImageContainer {...{ folder, image, config }}/>)}</main>
    <footer><BottomBar /></footer>
  </>)
}

export default App
