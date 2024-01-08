
export type ConfigData = {  
  auth: string[];
}

type MinAreaRect = [number, number, number, number, number];

export type Page = {
  minAreaRect: MinAreaRect;
  warnings: string[];
  rotatedHandle?:boolean;
};

export type KonvaPage = {
  n:number;
  x:number;
  y:number;
  width:number;
  height:number;
  rotation:number;
  warning:boolean;
  rotatedHandle?:boolean;
};

export type ScamImageData = {
  hidden?:boolean;
  checked?:boolean;
  selected?:number;
  height: number;
  img_path: string;
  pickle_path: string;
  rotation: number;
  thumbnail_info: {
    height: number;
    rotation: number;
    width: number;
  };
  thumbnail_path: string;
  width: number;
  pages?:Page[];
  rects?:KonvaPage[];
  options_index?:number;
};

type PreprocessOptions = {
  grayscale_thumbnail: boolean;
  pps: number;
  pre_rotate: number;
  sam_resize: number;
  thumbnail_resize: number;
  use_exif_rotation: boolean;
};

type PreprocessRun = {
  date: string;
  preprocess_options: PreprocessOptions;
  version: string;
};

export type ScamData = {
  checked: boolean;
  files:ScamImageData[],
  folder_path: string;
  preprocess_run: PreprocessRun;
  scam_runs: any[];
  options_list?:ScamOptions[];
};

export type Orientation = "vertical" | "horizontal" | "custom"

export type Direction = "vertical" | "horizontal"  ;

export type ScamDataState = 'new' | 'modified' | 'savedDraft' | 'uploaded'

export type SavedScamData = {
  time: number;
  data: ScamImageData;
  state: ScamDataState;
  image: ScamImageData;
  visible: boolean;
  checked: boolean;
  options?:ScamOptions;
}

export type SavedScamDataMap = {
  [str: string]: SavedScamData
}

export type ScamOptionsMap = {
  [k:string]: boolean | number | string | number[] | null
}

export type LocalData = {
  drafts: {
    [str:string]: {
      images: SavedScamDataMap;
      options: ScamOptions 
    }
  }, 
  sessions: {
    [str:string]: number
  },
  grid: string,
  options:ScamOptions
}

export type ScamOptions = {
  orient: Orientation,
  nbPages?: number,
  direc?: Direction,
  minRatio?: number,
  maxRatio?: number
  minAreaRatio?: number,
  maxAreaRatio?: number,
  minSquarish?: number,
  fixedWidth?: number,
  fixedHeight?: number,
  cutAtFixed?: boolean
}

export type Filter = 'all' | 'warning' | 'unchecked'

export type ScamQueue = {
  todo?:string[],
  pending?:string[],
  done?:string[]
} 