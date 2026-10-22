import type { UiController, UiState } from "@/ui/contract";
import type { TabId } from "@/ui/tabs";

export interface PageProps {
  controller: UiController;
  state: UiState;
  onNavigate: (tab: TabId) => void;
}
