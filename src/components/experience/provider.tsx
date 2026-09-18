"use client";

import { createContext, useContext } from "react";
import { DEFAULT_EXPERIENCE, type ExperienceMode } from "@/lib/experience";

const ExperienceContext = createContext<ExperienceMode>(DEFAULT_EXPERIENCE);

/** The signed-in person's mode, for the client components that draw the navigation. */
export function ExperienceProvider({ mode, children }: { mode: ExperienceMode; children: React.ReactNode }) {
  return <ExperienceContext.Provider value={mode}>{children}</ExperienceContext.Provider>;
}

export function useExperience(): ExperienceMode {
  return useContext(ExperienceContext);
}
