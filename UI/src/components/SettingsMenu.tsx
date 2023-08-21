import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme } from "@mui/material"
import { useState } from "react"
import { useAtom } from "jotai"

import * as state from "../state"

const SettingsMenu = (/*props: { folder:string, image: ScamImageData, config: ConfigData } */) => {
  //const { folder, config, image } = props;

  const [orient, setOrient] = useAtom(state.orientAtom) 
  const [direc, setDirec] = useAtom(state.direcAtom) 
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)
  
  //const [modified, setModified] = useAtom(state.modified)

  const [editRatio, setEditRatio] = useState(false)

  const theme = useTheme()

  return (<>
      <TextField
        sx={{ minWidth: 100, marginRight:"16px" }}
        select
        variant="standard"
        value={orient}
        label="Pages orientation"
        onChange={(r) => setOrient(r.target.value)}
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
            <TextField
              type="number"
              sx={{ width:"90px", marginRight:"8px" }}
              inputProps={{ style:{ textAlign: "left" }, step: 0.001, min:0.001, max:15.0 }}
              variant="standard"
              value={minRatio}
              onChange={(e) => setMinRatio(Number(e.target.value))}
              onFocus={() => setEditRatio(true)}
              onBlur={() => setEditRatio(false)}
            />
            <span style={{ fontSize: "16px", lineHeight: "30px" }}>...</span>
            <TextField
              type="number"
              sx={{ width:"90px", marginLeft:"8px" }}
              inputProps={{ step: 0.001, min:0.001, max:15.0 }}
              variant="standard"
              value={maxRatio}
              onChange={(e) => setMaxRatio(Number(e.target.value))}
              onFocus={() => setEditRatio(true)}
              onBlur={() => setEditRatio(false)}
            />
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
              onChange={(r) => setDirec(r.target.value)}
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