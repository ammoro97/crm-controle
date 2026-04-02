"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardCommercialView } from "@/components/dashboard/dashboard-commercial-view";
import { LeadsView } from "@/components/leads/leads-view";

export default function LeadsPage() {
  const searchParams = useSearchParams();

  const shouldOpenLeadDetail = useMemo(() => {
    const leadId = String(searchParams.get("leadId") || "").trim();
    return Boolean(leadId);
  }, [searchParams]);

  if (shouldOpenLeadDetail) {
    return <LeadsView title="Leads" filter="all" />;
  }

  return <DashboardCommercialView />;
}
