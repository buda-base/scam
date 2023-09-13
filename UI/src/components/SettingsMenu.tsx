import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, IconButton } from "@mui/material"
import { useEffect, useState } from "react"
import { useAtom } from "jotai"
import { SystemUpdateAlt } from "@mui/icons-material"
import debugFactory from "debug"

import * as state from "../state"
import { Orientation, Direction } from "../types"

const debug = debugFactory("scam:menu")

const SettingsMenu = (/*props: { folder:string, image: ScamImageData, config: ConfigData } */) => {
  //const { folder, config, image } = props;

  const [orient, setOrient] = useAtom(state.orientAtom) 
  const [direc, setDirec] = useAtom(state.direcAtom) 
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)
  
  //const [modified, setModified] = useAtom(state.modified)

  const [editRatio, setEditRatio] = useState(false)
  const [selectedRatio, setSelectedRatio ] = useAtom(state.selectedRatio) 

  useEffect(() => {
    if(maxRatio < minRatio) {
      const minR = minRatio
      const maxR = maxRatio
      setMinRatio(maxR)
      setMaxRatio(minR)
    }
  }, [ minRatio, maxRatio])

  //debug("sR:", selectedRatio)

  const theme = useTheme()

  return (<>
      <TextField
        sx={{ minWidth: 100, marginRight:"16px" }}
        select
        variant="standard"
        value={orient}
        label="Pages orientation"
        onChange={(r) => setOrient(r.target.value as Orientation)}
      >
        <MenuItem value={"vertical"}>vertical (modern books)</MenuItem>
        <MenuItem value={"horizontal"}>horizontal (pechas)</MenuItem>
        <MenuItem value={"custom"}>custom</MenuItem>
      </TextField>

      { orient === "custom" && <>
          <Box sx={{ marginRight:"16px", marginTop:"16px" }}>
            <InputLabel shrink={false} id="custom-label" style={{ fontSize:12, lineHeight: "14px", height:16, color: editRatio ? theme.palette.primary.main : theme.palette.text.secondary }}>
              Page aspect ratio range
            </InputLabel>
            <span>
              <IconButton disabled={selectedRatio === 0} onClick={() => setMinRatio(selectedRatio)}
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"110px", marginRight:"8px" }}
                inputProps={{ style:{ textAlign: "left", paddingLeft:"28px" }, step: 0.001, min:0.001, max:15.0 }}
                variant="standard"
                value={minRatio}
                onChange={(e) => setMinRatio(Number(e.target.value))}
                onFocus={() => setEditRatio(true)}
                onBlur={() => setEditRatio(false)}
              />
            </span>
            <span style={{ fontSize: "16px", lineHeight: "30px" }}>...</span>
            <span>
              <IconButton disabled={selectedRatio === 0}  onClick={() => setMaxRatio(selectedRatio)}
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", marginLeft:"7px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"110px", marginLeft:"8px" }}
                inputProps={{ step: 0.001, min:0.001, max:15.0, style: { paddingLeft:"28px" } }}
                variant="standard"
                value={maxRatio}
                onChange={(e) => setMaxRatio(Number(e.target.value))}
                onFocus={() => setEditRatio(true)}
                onBlur={() => setEditRatio(false)}
                />
            </span>
          </Box>
          <Box sx={{ marginTop:"16px" }}>
            <TextField
              type="number"
              sx={{ minWidth: 165, marginRight:"16px" }}
              inputProps={{ min:1, max:10 }}
              variant="standard"
              value={nbPages}
              label="Nb of pages expected"
              onChange={(r) => setNbPages(Number(r.target.value))}
            />
          </Box>
          <Box sx={{ marginTop:"16px" }}>
            <TextField
              sx={{ minWidth: 100, marginRight:"16px" }}
              select
              variant="standard"
              value={direc}
              label="Direction"
              onChange={(r) => setDirec(r.target.value as Direction)}
            >
              <MenuItem value={"vertical"}>vertical</MenuItem>
              <MenuItem value={"horizontal"}>horizontal</MenuItem>
            </TextField>
          </Box>
        </>
      }
  </>)
}

export default SettingsMenu