import { useSyncExternalStore } from "react";
import { recentColors, subscribeColorPreferences, userSwatches } from "@/utils/colorPreferences";

/** The user's swatches, kept up to date. */
export const useUserSwatches = () => useSyncExternalStore(subscribeColorPreferences, userSwatches, userSwatches);

/** The colour picker's recent colours, newest first. */
export const useRecentColors = () => useSyncExternalStore(subscribeColorPreferences, recentColors, recentColors);
