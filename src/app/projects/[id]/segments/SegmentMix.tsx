"use client";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, Select } from "@/components/ui";
import { TrendChart, type ChartSeries } from "@/components/analysis";
import { sortPeriodIds } from "@/lib/extraction/parseUtils";
import type { SegmentMetric } from "@/lib/types";

export function useSegmentData() {
  const { analysis } = useProject();
  return useMemo(() => {
    const segs = analysis.segments;
    const names = [...new Set(segs.map((s) => s.segment))];
    const periods = sortPeriodIds([...new Set(segs.map((s) => s.periodId))]);
    const get = (seg: string, p: string, m: SegmentMetric) => segs.find((s) => s.segment === seg && s.periodId === p && s.metric === m)?.dp.value ?? null;
    return { segs, names, periods, get };
  }, [analysis.segments]);
}

export function SegmentMix() {
  const { names, periods, get } = useSegmentData();
  const [kind, setKind] = useState<"FY" | "Q">("FY");
  const ps = periods.filter((p) => (kind === "FY" ? p.startsWith("FY") : p.startsWith("Q"))).slice(-16);
  if (!names.length) return <Callout tone="slate" title="Segment revenue">No segment table was extracted. Segment information usually appears in quarterly results and the segment note of the annual report.</Callout>;
  const series: ChartSeries[] = names.map((n) => ({ key: n, label: n, unit: "cr", type: "bar", values: Object.fromEntries(ps.map((p) => [p, get(n, p, "revenue")])) }));
  return (
    <Card>
      <CardHeader title="Segment revenue contribution" right={<Select value={kind} onChange={(v) => setKind(v as "FY" | "Q")} options={[{ value: "FY", label: "Annual" }, { value: "Q", label: "Quarterly" }]} />} />
      <CardBody className="p-0">
        <TrendChart title="" subtitle="Reported segment revenue (₹ crore), before inter-segment eliminations where so reported." periods={ps} series={series} selectable />
      </CardBody>
    </Card>
  );
}
