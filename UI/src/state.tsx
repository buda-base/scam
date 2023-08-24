import { atom } from "jotai"
import { atomWithReducer } from "jotai/utils"
import debugFactory from "debug"

import { ScamImageData, SavedScamDataMap } from "./types"

const debug = debugFactory("scam:state")

// global settings
export const orientAtom = atom("horizontal") 
export const direcAtom = atom("horizontal") 
export const minRatioAtom = atom(0.145)
export const maxRatioAtom = atom(0.5)
export const nbPagesAtom = atom(2)
export const configReady = atom<boolean|undefined>(undefined)

export const shouldRunAfterAtom = atom(123)

export const scamDataReducer = (state: any, action: { type: string; payload: { id: string; val: ScamImageData } }) => {
  debug("!!", action)
  switch (action.type) {
    case 'ADD_DATA':
      return { ...state, [action.payload.id]: { ...action.payload.val } };
    case 'UPDATE_DATA':
        return { ...state, [action.payload.id]: { ...state[action.payload.id]||{}, ...action.payload.val } };
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
export const grid = atom('2x1') //'1x1')

export const keyDown = atom('')
export const focused = atom('')

export const deselectAll = atom(false)