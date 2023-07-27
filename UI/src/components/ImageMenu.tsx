
import { IconButton } from '@mui/material';
import { Rotate90DegreesCw, VisibilityOff, Close, AddBox } from '@mui/icons-material';


const ImageMenu = (props: { /*folder:string, image: ScamImageData, config: ConfigData*/ }) => {
  //const { folder, config, image } = props;

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
      <IconButton disabled>
        <Close /*className={"disabled"}*/ />
      </IconButton>
    </span>
  </div>)
}

export default ImageMenu ;