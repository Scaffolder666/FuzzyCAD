import { useState } from "react";

const STORAGE_KEY = "fuzzycad.identity.name";

function readStoredName() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

/**
 * Lightweight "who am I" name, persisted locally per browser. There's no
 * real auth/session concept in this app yet — this is just enough identity
 * to stamp an annotation's author and to filter an "assigned to me" list.
 */
export function useLocalIdentity() {
  const [name, setNameState] = useState(readStoredName);

  function setName(next: string) {
    setNameState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return { name, setName };
}
