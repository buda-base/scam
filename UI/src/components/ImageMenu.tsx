
import { IconButton } from '@mui/material';
import { Rotate90DegreesCw, VisibilityOff, Visibility, DeleteForever, AddBox } from '@mui/icons-material';
import debugFactory from "debug"
import { useCallback } from 'react';
import { useAtom } from 'jotai';

import { ScamImageData } from '../types';
import { theme } from './theme';
import * as state from "../state"

const debug = debugFactory("scam:imenu");

const ImageMenu = (props: { selectedId: number|null, addNew: boolean, visible:boolean,
    removeId: (n: number) => void, setAddNew: (b:boolean) => void, selectShape:(n:number|null) => void, rotate:(n:number) => void,
    toggleVisible:() => void }) => {
  const { selectedId, addNew, visible, removeId, setAddNew, selectShape, rotate, toggleVisible } = props;

  //debug("menu", selectedId)

  const handleDelete = useCallback(() => {
    //debug("remove:", selectedId)
    if(selectedId != null) removeId(selectedId)
  }, [removeId, selectedId])

  const handleAdd = () => {
    if(!addNew) selectShape(null)
    setAddNew(!addNew)
  }

  return (<div className="image-menu">
    <span>
      
      <IconButton onClick={toggleVisible}>
        { visible && <VisibilityOff /> }
        { !visible && <Visibility /> }
      </IconButton>
      <IconButton onClick={() => rotate(-90)} >
        <Rotate90DegreesCw style={{ transform: "scaleY(-1) rotate(-135deg)" }} />
      </IconButton>
      <IconButton onClick={() => rotate(90)} >
        <Rotate90DegreesCw style={{ transform: "rotate(45deg)" }} />
      </IconButton>
    </span>
    <span>
      <IconButton onClick={handleAdd} >
        <AddBox {...addNew?{sx:{color:theme.palette.primary.main}}:{}}/>
      </IconButton>
      <IconButton onClick={handleDelete} disabled={selectedId === null} >
        <DeleteForever />
      </IconButton>
    </span>
  </div>)
}

export default ImageMenu ;