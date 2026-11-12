import { createContext, useContext } from 'react';

/** Slug → name of the specialists, for the choices of the editor below it. */
export const SpecialistNames = createContext<ReadonlyMap<string, string>>(new Map());

export function useSpecialistNames(): ReadonlyMap<string, string> {
  return useContext(SpecialistNames);
}
