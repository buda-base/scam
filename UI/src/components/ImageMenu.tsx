
import { Rotate90DegreesCw, VisibilityOff, Close, AddBox } from '@mui/icons-material';


const ImageMenu = (props: { /*folder:string, image: ScamImageData, config: ConfigData*/ }) => {
  //const { folder, config, image } = props;

  return (<div className="image-menu">
    <span>
      <VisibilityOff style={{ marginRight: "5px" }}/>
      <Rotate90DegreesCw style={{ transform: "rotate(45deg)" }}/>
      <Rotate90DegreesCw style={{ transform: "scaleY(-1) rotate(-135deg)" }}/>
    </span>
    <span>
      <AddBox />
      <Close className={"disabled"} />
    </span>
  </div>)
}

export default ImageMenu ;