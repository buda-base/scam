
import { IconButton } from '@mui/material';
import { Rotate90DegreesCw, VisibilityOff, DeleteForever, AddBox } from '@mui/icons-material';
import debugFactory from "debug"
import { useCallback } from 'react';

import { ScamImageData } from '../types';

const debug = debugFactory("scam:imenu");

const ImageMenu = (props: { selectedId: number|null, removeId: (n: number) => void }) => {
  const { selectedId, removeId} = props;

  //debug("menu", selectedId)

  const handleDelete = useCallback(() => {
    //debug("remove:", selectedId)
    if(selectedId != null) removeId(selectedId)
  }, [removeId, selectedId])

  return (<div className="image-menu">
    <span>
      
      <IconButton>
        <VisibilityOff />
      </IconButton>
      <IconButton>
        <Rotate90DegreesCw style={{ transform: "rotate(45deg)" }}/>
      </IconButton>
      <IconButton>
        <Rotate90DegreesCw style={{ transform: "scaleY(-1) rotate(-135deg)" }}/>
      </IconButton>
    </span>
    <span>
      <IconButton>
        <AddBox />
      </IconButton>
      <IconButton onClick={handleDelete} disabled={selectedId === null} >
        <DeleteForever />
      </IconButton>
    </span>
  </div>)
}

export default ImageMenu ;