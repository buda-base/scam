import { useEffect, useState } from 'react'
import axios from 'axios';
import debugFactory from "debug"

// tmp data
import data from "./assets/scam.json"

import ScamImage from "./components/ScamImage"
import './App.css'
import { ConfigData, ScamData, ScamImageData } from './types';

const debug = debugFactory("scam:app")

export const apiUrl = 'https://scamqcapi.bdrc.io/'        

function App() {

  const [config, setConfig] = useState<ConfigData>({} as ConfigData)
  const [images, setImages] = useState<ScamImageData[]>([])
  const [json, setJson] = useState<ScamData>({} as ScamData)

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
    if(config.auth) axios
      .post(apiUrl + "get_scam_json", {
        folder_path: 'Bruno/Reruk/',
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: "Basic " + config.auth.join(":")
        },
      })
      .then(response => {
        debug("json",response.data);
      })
      .catch(error => {
        console.error(error);

        // use preloaded local data
        setJson(data)
      });

  }, [config])

  useEffect( () => {
    if(json.files) setImages(json.files)
  }, [json])

  return (<>
    <header></header>
    <main>{images.slice(10).map(image => <ScamImage {...{ image, config }}/>)}</main>
    <footer></footer>
  </>)
}

export default App
