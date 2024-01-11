import { FormControl, InputLabel, Select, MenuItem, Box, TextField, useTheme, IconButton, Checkbox } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { useAtom } from "jotai"
import { SystemUpdateAlt } from "@mui/icons-material"
import debugFactory from "debug"

import * as state from "../state"
import { Orientation, Direction } from "../types"
import { ColorButtonAlt } from "./theme"

const debug = debugFactory("scam:menu")

const SettingsMenu = (/*props: { folder:string, image: ScamImageData, config: ConfigData } */) => {
  //const { folder, config, image } = props;

  const [orient, setOrient] = useAtom(state.orientAtom) 
  const [direc, setDirec] = useAtom(state.direcAtom) 
  const [minRatio, setMinRatio] = useAtom(state.minRatioAtom)
  const [maxRatio, setMaxRatio] = useAtom(state.maxRatioAtom)
  const [nbPages, setNbPages] = useAtom(state.nbPagesAtom)
  const [minAreaRatio, setMinAreaRatio] = useAtom(state.minAreaRatioAtom)
  const [maxAreaRatio, setMaxAreaRatio] = useAtom(state.maxAreaRatioAtom)
  const [minSquarish, setMinSquarish] = useAtom(state.minSquarishAtom)
  const [fixedWidth, setFixedWidth] = useAtom(state.fixedWidthAtom)
  const [fixedHeight, setFixedHeight] = useAtom(state.fixedHeightAtom)
  const [cutAtFixed, setCutAtFixed] = useAtom(state.cutAtFixedAtom)
  
  //const [modified, setModified] = useAtom(state.modified)

  const [editRatio, setEditRatio] = useState(false)
  const [editAreaRatio, setEditAreaRatio] = useState(false)
  const [editCutAtFixed, setEditCutAtFixed] = useState(false)

  const [selectedRatio, setSelectedRatio ] = useAtom(state.selectedRatio) 
  const [selectedAreaRatio, setSelectedAreaRatio ] = useAtom(state.selectedAreaRatio) 
  const [selectedCutAtFixed, setSelectedCutAtFixed ] = useAtom(state.selectedCutAtFixed) 

  /* // better show a warning
  useEffect(() => {
    if(maxRatio < minRatio) {
      const minR = minRatio
      const maxR = maxRatio
      setMinRatio(maxR)
      setMaxRatio(minR)
    }
  }, [ minRatio, maxRatio])

  useEffect(() => {
    if(maxAreaRatio < minAreaRatio) {
      const minR = minAreaRatio
      const maxR = maxAreaRatio
      setMinAreaRatio(maxR)
      setMaxAreaRatio(minR)
    }
  }, [ minAreaRatio, maxAreaRatio])
  */
 
  //debug("sR:", selectedRatio)

  const theme = useTheme()

  const importFromAnnotation = useCallback(() => {
    setMinRatio(selectedRatio*0.85)
    setMaxRatio(selectedRatio*1.15)
    setMinAreaRatio(selectedAreaRatio*0.85)
    setMaxAreaRatio(selectedAreaRatio*1.15)
  }, [selectedRatio, selectedAreaRatio])

  return (<>
      <Box sx={{ display:"flex", alignItems: "flex-end" }}>
        <TextField
          sx={{ minWidth: 100, marginRight:"16px" }}
          select
          variant="standard"
          value={orient}
          label="Configuration" //"Pages orientation"
          onChange={(r) => setOrient(r.target.value as Orientation)}
          >
          <MenuItem value={"vertical"}>vertical (modern books)</MenuItem>
          <MenuItem value={"horizontal"}>horizontal (pechas)</MenuItem>
          <MenuItem value={"custom"}>custom</MenuItem>
        </TextField>
        { orient === "custom" && <ColorButtonAlt onClick={importFromAnnotation} disabled={selectedRatio === 0} sx={{ margin:"0px 0 0 20px", textAlign: "right" }}>
          <SystemUpdateAlt sx={{height:16,transform:"rotate(180deg)"}} />
          import from<br/>annotation
        </ColorButtonAlt> }
      </Box>

      { orient === "custom" && <>
          <Box sx={{ marginRight:"16px", marginTop:"16px" }}>
            <InputLabel shrink={false} id="custom-label" style={{ fontSize:12, lineHeight: "14px", height:16, color: editRatio ? theme.palette.primary.main : theme.palette.text.secondary }}>
              Page aspect ratio range
            </InputLabel>
            <span style={{ position:"relative" }}>
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
            <span style={{ position:"relative" }}>
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
              label="Num. of pages expected"
              onChange={(r) => setNbPages(Number(r.target.value))}
            />
          </Box>
          <Box sx={{ marginTop:"16px" }}>
            <TextField
              sx={{ minWidth: 100, marginRight:"16px" }}
              select
              variant="standard"
              value={direc}
              label="Annotation layout" //"Direction"
              onChange={(r) => setDirec(r.target.value as Direction)}
            >
              <MenuItem value={"vertical"}>vertical (top to bottom)</MenuItem>
              <MenuItem value={"horizontal"}>horizontal (left to right)</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ marginRight:"16px", marginTop:"16px" }}>
            <InputLabel shrink={false} id="custom-label" style={{ fontSize:12, lineHeight: "14px", height:16, color: editAreaRatio ? theme.palette.primary.main : theme.palette.text.secondary }}>
              Area ratio range
            </InputLabel>
            <span style={{ position:"relative" }}>
              <IconButton disabled={selectedAreaRatio === 0} onClick={() => setMinAreaRatio(selectedAreaRatio)}
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"110px", marginRight:"8px" }}
                inputProps={{ style:{ textAlign: "left", paddingLeft:"28px" }, step: 0.001, min:0.001, max:15.0 }}
                variant="standard"
                value={minAreaRatio}
                onChange={(e) => setMinAreaRatio(Number(e.target.value))}
                onFocus={() => setEditAreaRatio(true)}
                onBlur={() => setEditAreaRatio(false)}
              />
            </span>
            <span style={{ fontSize: "16px", lineHeight: "30px" }}>...</span>
            <span style={{ position:"relative" }}>
              <IconButton disabled={selectedAreaRatio === 0}  onClick={() => setMaxAreaRatio(selectedAreaRatio)}
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", marginLeft:"7px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"110px", marginLeft:"8px" }}
                inputProps={{ step: 0.001, min:0.001, max:15.0, style: { paddingLeft:"28px" } }}
                variant="standard"
                value={maxAreaRatio}
                onChange={(e) => setMaxAreaRatio(Number(e.target.value))}
                onFocus={() => setEditAreaRatio(true)}
                onBlur={() => setEditAreaRatio(false)}
                />
            </span>
          </Box>
          <Box sx={{ marginTop:"16px" }}>
            <TextField
              type="number"
              sx={{ minWidth: 165, marginRight:"16px" }}
              inputProps={{ min:0, max:1, step:0.001 }}
              variant="standard"
              value={minSquarish}
              label="Min. squarishness"
              onChange={(r) => setMinSquarish(Number(r.target.value))}
            />
          </Box>
          <Box sx={{ marginRight:"16px", marginTop:"16px", alignItems: "baseline" }}>
            <InputLabel shrink={false} id="custom-label" style={{ fontSize:12, lineHeight: "14px", height:16, color: editCutAtFixed ? theme.palette.primary.main : theme.palette.text.secondary }}>
              Cut at fixed resolution
            </InputLabel>
            <Checkbox checked={cutAtFixed} sx={{ marginLeft:"-12px", marginTop:"-6px"}} onChange={(ev) => setCutAtFixed(ev.target.checked)} />
            <span style={{ position:"relative" }}>
              <IconButton disabled={!cutAtFixed || !selectedCutAtFixed.length}  onClick={() => setFixedWidth(Math.round(selectedCutAtFixed[0])) }
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"100px", marginRight:"8px" }}
                inputProps={{ style:{ textAlign: "left", paddingLeft:"28px" }, step: 1, min:-1, max:10000 }}
                variant="standard"                
                value={fixedWidth}
                disabled={!cutAtFixed}
                onChange={(e) => setFixedWidth(Number(e.target.value))}
                onFocus={() => setEditCutAtFixed(true)}
                onBlur={() => setEditCutAtFixed(false)}
              />
            </span>
            <span style={{ fontSize: "16px", lineHeight: "30px" }}> : </span>
            <span style={{ position:"relative" }}>
              <IconButton disabled={!cutAtFixed || !selectedCutAtFixed.length}  onClick={() => setFixedHeight(Math.round(selectedCutAtFixed[1])) }
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", position: "absolute", marginTop:"3px", marginLeft:"7px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton>
              <TextField
                type="number"
                sx={{ width:"100px", marginLeft:"8px" }}
                inputProps={{ step: 1, min:-1, max:10000, style: { paddingLeft:"28px" }}}
                variant="standard"
                value={fixedHeight}
                disabled={!cutAtFixed}
                onChange={(e) => setFixedHeight(Number(e.target.value))}
                onFocus={() => setEditCutAtFixed(true)}
                onBlur={() => setEditCutAtFixed(false)}
                />
            </span>
              {/* <IconButton disabled={!cutAtFixed || !selectedCutAtFixed.length} onClick={() => { setFixedWidth(selectedCutAtFixed[0]); setFixedHeight(selectedCutAtFixed[1]); }}
                  sx={{width:24, height:24, transform:"rotate(180deg)", color:"black", marginLeft:"5px", marginTop:"-5px", zIndex:1}}>
                <SystemUpdateAlt sx={{height:16}} />
              </IconButton> */}
          </Box>
        </>
      }
  </>)
}

export default SettingsMenu