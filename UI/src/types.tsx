
export type ConfigData = {  
  auth: string[];
}

type MinAreaRect = [number, number, number, number, number];

type Page = {
  minAreaRect: MinAreaRect;
  warnings: string[];
};

export type ScamImageData = {
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
