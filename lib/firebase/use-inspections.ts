import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth/session";

import { type InspectionSummary, subscribeInspections } from "./inspections";

/** The signed-in user's inspections, newest first. Null while loading. */
export function useInspections(): InspectionSummary[] | null {
  const { user } = useSession();
  const [list, setList] = useState<InspectionSummary[] | null>(null);
  useEffect(() => (user ? subscribeInspections(user.uid, setList) : undefined), [user]);
  return list;
}
