from scaapi import run_scam_image

DATA = {
	"file_info": {
		"height": 2136,
		"img_path": "Ka01-03/141.JPG",
		"pickle_path": "sam_pickle_gz/Bruno2/gZungs chen Ka/Ka01-03/141.JPG_sam_pickle.gz",
		"rotation": 0,
		"thumbnail_info": {
			"height": 512,
			"rotation": 0,
			"width": 770
		},
		"thumbnail_path": "thumbnails/Bruno2/gZungs chen Ka/Ka01-03/141.JPG.jpg",
		"width": 3216
	},
	"folder_path": "Bruno2/gZungs chen Ka/",
	"scam_options": {
		"alter_checked": False,
		"area_diff_max": 0.15,
		"area_diff_max_warn": 0.7,
		"area_ratio_range": [
			0.2,
			0.9
		],
		"cut_at_fixed": False,
		"direction": "vertical",
		"expand_to_fixed": False,
		"fixed_height": None,
		"fixed_width": None,
		"nb_pages_expected": 2,
		"squarishness_min": 0.85,
		"squarishness_min_warn": 0.7,
		"use_rotation": True,
		"wh_ratio_range": [
			2,
			7
		],
		"wh_ratio_range_warn": [
			1.5,
			10
		]
	}
}

print(run_scam_image(DATA["folder_path"], DATA["file_info"], DATA["scam_options"]))