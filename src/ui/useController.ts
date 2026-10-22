import { useEffect, useState } from "preact/hooks";
import type { UiController, UiState } from "./contract";

export function useController(controller: UiController): UiState {
  const [state, setState] = useState<UiState>(controller.state);
  useEffect(() => {
    setState(controller.state);
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}
