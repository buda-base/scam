
import { IconButton, Menu, MenuItem, Paper } from '@mui/material';
import { Rotate90DegreesCw, VisibilityOff, Visibility, DeleteForever, AddBox, TaskAlt, Check, CheckCircle, LocalOffer, ChevronRight } from '@mui/icons-material';
import debugFactory from "debug"
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';

import { ScamImageData } from '../types';
import { theme } from './theme';
import * as state from "../state"

const debug = debugFactory("scam:imenu");

const ImageMenu = (props: { selectedId: number|null, addNew: boolean, visible:boolean, checked: boolean, tags?:string[],
    removeId: (n: number) => void, setAddNew: (b:boolean) => void, selectShape:(n:number|null) => void, rotate:(n:number) => void,
    toggleVisible:() => void, toggleCheck: (b?:boolean) => void, updateTags:(t:string[]) => void }) => {
  const { selectedId, addNew, visible, checked, tags, removeId, setAddNew, selectShape, rotate, toggleVisible, toggleCheck, updateTags } = props;

  //debug("menu", selectedId)

  const handleDelete = useCallback(() => {
    //debug("remove:", selectedId)
    if(selectedId != null) removeId(selectedId)
  }, [removeId, selectedId])

  const handleCheck = useCallback((multi:boolean) => {
    toggleCheck(multi)
    setCheckedMenu(false)
  }, [toggleCheck])

  const handleAdd = () => {
    if(!addNew) selectShape(null)
    setAddNew(!addNew)
  }

  const [checkedMenu, setCheckedMenu] = useState(false) 
  
  const [deselectAll, setDeselectAll] = useAtom(state.deselectAll)
  const handleClick = useCallback(() => { 
    if(selectedId == null) { 
      setDeselectAll(true)
    }
  },[selectedId, checkedMenu])

  const [tagMenu, setTagMenu] = useState(false) 


  useEffect(() => {
    if(selectedId === null) { 
      setTagMenu(false)
      setCheckedMenu(false)
    }
  }, [selectedId])

  useEffect(() => {
    if(checkedMenu) setTagMenu(false)    
  }, [checkedMenu])

  useEffect(() => {
    if(tagMenu) setCheckedMenu(false)    
  }, [tagMenu])

  const handleToggleTag = useCallback((t:string, isPage?:boolean) => {
    debug("t:", t, tags)
    let useTags = tags ?? []
    if(isPage) useTags = tags?.filter(t => !t.match(/^T1[0-9]+$/)) ?? []
    if(tags?.includes(t)) updateTags(useTags.filter(g => g!=t))
    else updateTags([...useTags, t])
    setTagMenu(false)
  }, [tags])
  
  const [pageNumberMenu, setPageNumberMenu] = useState(false)

  return (
    <div className="image-menu" onClick={handleClick} style={{justifyContent:"center"}}>
      <div style={{minWidth:"350px",maxWidth:"100%",display:"flex",justifyContent: "space-around"}}>
    <span>
      <IconButton onClick={() => setCheckedMenu(!checkedMenu)}>
        { checked 
          ? <CheckCircle sx={{color:"green"}} />        
          : <TaskAlt /> }
      </IconButton>
      { /*visible &&*/ checkedMenu && <Paper sx={{ position: "absolute", bottom:"100%", marginLeft:"0px" }}>
        { checked 
          ? <>
              <MenuItem onClick={() => handleCheck(false)}>Uncheck this image only</MenuItem>
              <MenuItem onClick={() => handleCheck(true)}>Uncheck with previous images</MenuItem>
            </>
          : <>
              <MenuItem onClick={() => handleCheck(false)}>Check this image only</MenuItem>
              <MenuItem onClick={() => handleCheck(true)}>Check with previous images</MenuItem>
        </>
        }
      </Paper> }
      <IconButton onClick={toggleVisible} className="visibility">
        { visible && <VisibilityOff /> }
        { !visible && <Visibility /> }
      </IconButton>

    </span>
    <span>
      <IconButton onClick={() => rotate(90)} >
        <Rotate90DegreesCw style={{ transform: "scaleY(-1) rotate(-135deg)" }} />
      </IconButton>
      <IconButton onClick={() => rotate(-90)} >
        <Rotate90DegreesCw style={{ transform: "rotate(45deg)" }} />
      </IconButton>
    </span>
    <span>
      <span style={{ position:"relative" }}>
        <IconButton className="tag" onClick={() => setTagMenu(!tagMenu)} disabled={selectedId === null} ><LocalOffer /></IconButton>
        { tagMenu && <Paper sx={{ position: "absolute", right:0, bottom:"calc(100% + 24px)" }}>
          {Object.keys(state.possibleTags).map((t:string) => 
            <MenuItem title={""} selected={tags?.includes(t)} onClick={() => handleToggleTag(t)}>{state.possibleTags[t][0].toUpperCase()+state.possibleTags[t].substring(1)}</MenuItem>
          )}
            <MenuItem onMouseEnter={() => setPageNumberMenu(true)} onMouseLeave={() => setPageNumberMenu(false)} >
              Page numbering <ChevronRight/>
            </MenuItem>
        </Paper> }
        { tagMenu && pageNumberMenu && <Paper sx={{ position: "absolute", left:"100%", top:-260, zIndex:1 }} onMouseOver={() => setPageNumberMenu(true)} >
            {Array.from({length:12}, (_,i) => { 
              const t = "T1"+((i+1)+"").padStart(2,"0")
              return <MenuItem selected={tags?.includes(t)} onClick={() => handleToggleTag(t, true)}>Page {i+1}</MenuItem>
            })}
        </Paper> }
      </span>
      <IconButton onClick={handleAdd} >
        <AddBox {...addNew?{sx:{color:"black"}}:{}}/>
      </IconButton>
      <IconButton onClick={handleDelete} disabled={selectedId === null} >
        <DeleteForever />
      </IconButton>
    </span>
  </div></div>)
}

export default ImageMenu ;