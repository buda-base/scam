
export type ConfigData = {  
  auth: string[];
}

type MinAreaRect = [number, number, number, number, number];

export type Page = {
  minAreaRect: MinAreaRect;
  warnings: string[];
};

export type KonvaPage = {
  n:number;
  x:number;
  y:number;
  width:number;
  height:number;
  rotation:number;
  warning:boolean;
};

export type ScamImageData = {
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
};

export type Direction = "vertical" | "horizontal" | "custom" ;

export type ScamDataState = 'new' | 'modified' | 'savedDraft' | 'savedOnline'

export type SavedScamData = {
  time: number;
  data: ScamImageData;
  state: ScamDataState;
  image: ScamImageData;
}

export type SavedScamDataMap = {
  [str: string]: SavedScamData
}

export type LocalData = {
  drafts: {
    [str:string]: SavedScamDataMap
  }
}
