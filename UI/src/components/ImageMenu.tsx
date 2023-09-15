
import { IconButton } from '@mui/material';
import { Rotate90DegreesCw, VisibilityOff, Visibility, DeleteForever, AddBox, TaskAlt, Check, CheckCircle } from '@mui/icons-material';
import debugFactory from "debug"
import { useCallback, useState } from 'react';
import { useAtom } from 'jotai';

import { ScamImageData } from '../types';
import { theme } from './theme';
import * as state from "../state"

const debug = debugFactory("scam:imenu");

const ImageMenu = (props: { selectedId: number|null, addNew: boolean, visible:boolean, checked: boolean,
    removeId: (n: number) => void, setAddNew: (b:boolean) => void, selectShape:(n:number|null) => void, rotate:(n:number) => void,
    toggleVisible:() => void, toggleCheck: () => void }) => {
  const { selectedId, addNew, visible, checked, removeId, setAddNew, selectShape, rotate, toggleVisible, toggleCheck } = props;

  //debug("menu", selectedId)

  const handleDelete = useCallback(() => {
    //debug("remove:", selectedId)
    if(selectedId != null) removeId(selectedId)
  }, [removeId, selectedId])

  const handleAdd = () => {
    if(!addNew) selectShape(null)
    setAddNew(!addNew)
  }
  
  const [deselectAll, setDeselectAll] = useAtom(state.deselectAll)
  const handleClick = useCallback(() => { 
    if(selectedId == null) setDeselectAll(true)
  },[selectedId])

  return (<div className="image-menu" onClick={handleClick}>
    <span>
      <IconButton onClick={toggleCheck}>
        { checked 
          ? <CheckCircle sx={{color:"green"}} />        
          : <TaskAlt /> }
      </IconButton>
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
      <IconButton onClick={handleAdd} >
        <AddBox {...addNew?{sx:{color:"black"}}:{}}/>
      </IconButton>
      <IconButton onClick={handleDelete} disabled={selectedId === null} >
        <DeleteForever />
      </IconButton>
    </span>
  </div>)
}

export default ImageMenu ;