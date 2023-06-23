import { useEffect, useState } from 'react'
import axios from 'axios';
import debugFactory from "debug"

import ScamImage from "./components/ScamImage"
import './App.css'

const debug = debugFactory("scam:app")

const apiUrl = 'https://scamqcapi.bdrc.io'        

function App() {

  const [images, setImages] = useState([])

  // load config file onstartup
  useEffect(() => {
    axios.get('/config.json')
      .then(response => {
        const config = response.data
        debug("config",config)

        const requestData = {
          folder_path: 'Bruno/Reruk/',
        };
        
        axios
          .get(apiUrl + "/get_scam_json", requestData, {
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
          });

      })
      .catch(error => {
        console.error(error);
      });


  }, [])

  return (<>
    <header></header>
    <main>{images.map(image => <ScamImage {...{ image }}/>)}</main>
    <footer></footer>
  </>)
}

export default App
