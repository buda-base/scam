import { atom } from "jotai"
import { atomWithReducer } from "jotai/utils"
import debugFactory from "debug"

import { ScamImageData, SavedScamDataMap, ScamOptionsMap, ScamOptions, Direction, Orientation, LocalData } from "./types"

const debug = debugFactory("scam:state")

const hasCustomOptions:ScamOptions|undefined = (JSON.parse(localStorage.getItem("scamUI") || "{}") as LocalData ).options

// global settings
export const orientAtom = atom<Orientation>("horizontal") 
export const direcAtom = atom<Direction>("horizontal") 
export const minRatioAtom = atom(hasCustomOptions?.minRatio || 0.145)
export const maxRatioAtom = atom(hasCustomOptions?.maxRatio || 0.5)
export const nbPagesAtom = atom(hasCustomOptions?.nbPages || 2)
export const minAreaRatioAtom = atom(hasCustomOptions?.minAreaRatio || 0.2)
export const maxAreaRatioAtom = atom(hasCustomOptions?.maxAreaRatio || 0.9)
export const minSquarishAtom = atom(hasCustomOptions?.minSquarish || 0.85)
export const configReady = atom<boolean|undefined>(undefined)
export const fixedWidthAtom = atom(hasCustomOptions?.fixedWidth || -1)
export const fixedHeightAtom = atom(hasCustomOptions?.fixedHeight || -1)
export const cutAtFixedAtom = atom(hasCustomOptions?.cutAtFixed || false)

export const shouldRunAfterAtom = atom(123)

export const scamDataReducer = (state: any, action: { type: string; payload: { id: string; val: ScamImageData; multid?:string[] } }) => {
  //debug("!!", action)
  switch (action.type) {
    case 'ADD_DATA':
      return { ...state, [action.payload.id]: { ...action.payload.val } };
    case 'UPDATE_DATA':
      return { ...state, [action.payload.id]: { ...state[action.payload.id]||{}, ...action.payload.val } };
    case 'UPDATE_DATA_MULTI': {
      const newState = { ...state }
      for(const id of action.payload.multid || []) {
        newState[id] = { ...newState[id], ...action.payload.val }
      }  
      return newState
    }
    case 'LOAD_DRAFT':
      return { [action.payload.id]: action.payload.val };
    case 'RESET_DATA':
      return {  };
    default:
      return state;
  }
}

export const allScamDataAtom = atomWithReducer<SavedScamDataMap, any>({}, scamDataReducer)

export const modified = atom(false)
export const drafted = atom(false)

export const filter = atom('all')
export const grid = atom('3x2') 

export const keyDown = atom('')
export const focused = atom('')

export const deselectAll = atom(false)

export const restrictRun = atom(false)
export const checkedRestrict = atom(false)

export const scamOptions = atom<ScamOptions>({ orient: "horizontal" })
export const scamOptionsSelected = atom<ScamOptions>({ orient: "horizontal" })
export const globalScamOptionsUpdate = atom<boolean>(false)

export const configs = atom<ScamOptions[]>([])

export const selectedRatio = atom(0)
export const selectedAreaRatio = atom(0)
export const selectedCutAtFixed = atom<number[]>([])

export const showSettings = atom(false);