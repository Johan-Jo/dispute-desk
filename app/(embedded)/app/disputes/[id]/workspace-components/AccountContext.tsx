"use client";

import { createContext, useContext } from "react";
import type { DisputeAccountVm } from "../hooks/useDisputeAccount";

/** The dispute account, shared by the three tabs (one record, many readers). */
export const AccountContext = createContext<DisputeAccountVm | null>(null);

export function useAccount(): DisputeAccountVm | null {
  return useContext(AccountContext);
}
