"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * The console is dark, whatever the person's own preference.
 *
 * The tokens live on the `dark` class of the document, so portals — menus, dialogs, toasts — take
 * it too. It is put on for as long as the console is open and taken off on the way out, without
 * touching the stored preference: leaving the console gives the workspace back exactly as it was.
 */
export function AdminTheme() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.dataset.surface = "admin";
    return () => {
      if (resolvedTheme !== "dark") root.classList.remove("dark");
      delete root.dataset.surface;
    };
  }, [resolvedTheme]);
  return null;
}
