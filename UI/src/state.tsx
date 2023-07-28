import { atom } from "jotai"
import { atomWithReducer } from "jotai/utils"
import debugFactory from "debug"

import { ScamImageData, SavedScamData } from "./types"

const debug = debugFactory("scam:state")

// global settings
export const orientAtom = atom("horizontal") 
export const direcAtom = atom("horizontal") 
export const minRatioAtom = atom(1.0)
export const maxRatioAtom = atom(2.0)
export const nbPagesAtom = atom(2)

export const shouldRunAfterAtom = atom(1)

export const scamDataReducer = (state, action) => {
    
//  debug("state:", state, action)

  switch (action.type) {
    case 'ADD_DATA':
      return { ...state, [action.payload.id]: action.payload.val };
    default:
      return state;
  }
}

export const allScamDataAtom = atomWithReducer<SavedScamData>({}, scamDataReducer)
