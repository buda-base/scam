import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme } from "@mui/material"
import { useState } from "react"


const BottomBar = (props: { /*folder:string, image: ScamImageData, config: ConfigData*/ }) => {
  //const { folder, config, image } = props;

  const [orient, setOrient] = useState("horizontal") 
  const [direc, setDirec] = useState("horizontal") 
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
          <Box sx={{ marginRight:"16px" }}>
            <InputLabel shrink={false} id="custom-label" style={{ fontSize:12, lineHeight: "14px", height:16, color: editRatio ? theme.palette.primary.main : theme.palette.text.secondary }}>
              Page aspect ratio range
            </InputLabel>
            <TextField
              //type="number"
              sx={{ width:"65px", marginRight:"8px" }}
              inputProps={{ style:{ textAlign: "right" }}}
              variant="standard"
              value="1.0"
              onFocus={() => setEditRatio(true)}
              onBlur={() => setEditRatio(false)}
            />
            <span style={{ fontSize: "16px", lineHeight: "30px" }}>...</span>
            <TextField
              //type="number"
              sx={{ width:"65px", marginLeft:"8px" }}
              variant="standard"
              value="2.0"
              onFocus={() => setEditRatio(true)}
              onBlur={() => setEditRatio(false)}
            />
          </Box>
          <TextField
            sx={{ minWidth: 100, marginRight:"16px" }}
            variant="standard"
            //value={direc}
            label="# pages expected"
            //onChange={(r) => setDirec(r.target.value)}
          />
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
        </>
      }
  </>)
}

export default BottomBar