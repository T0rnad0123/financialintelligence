"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocMeta, Project } from "@/lib/types";
import { getProject, listDocs, saveProject } from "@/lib/store/db";
import { analyze, type Analysis } from "@/lib/engine/analyze";
import { seedScenarios } from "@/lib/engine/valuation";
import { fetchAiStatus, type AiStatus } from "@/lib/ai/client";
import { remergeProject } from "@/lib/store/pipeline";

interface Ctx {
  project: Project;
  docs: DocMeta[];
  analysis: Analysis;
  ai: AiStatus | null;
  update: (fn: (p: Project) => Project) => void;
  setDocs: React.Dispatch<React.SetStateAction<DocMeta[]>>;
  reloadDocs: () => Promise<void>;
  remerge: () => Promise<void>;
  saving: boolean;
  fyRange: string[];
}

const ProjectCtx = createContext<Ctx | null>(null);

export function useProject(): Ctx {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("useProject must be used inside ProjectProvider");
  return c;
}

export function ProjectProvider({ id, children }: { id: string; children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Project | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await getProject(id);
        if (!alive) return;
        if (!p) {
          setError("Project not found in this browser. Projects are stored locally — they do not sync across browsers or devices.");
          return;
        }
        setProject(p);
        latest.current = p;
        setDocs(await listDocs(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    fetchAiStatus().then((s) => alive && setAi(s));
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    if (!latest.current) return;
    setSaving(true);
    try {
      await saveProject(latest.current);
    } finally {
      setSaving(false);
    }
  }, []);

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = { ...fn(prev), updatedAt: Date.now() };
        latest.current = next;
        return next;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 250);
    },
    [flush],
  );

  useEffect(() => () => void (timer.current && (clearTimeout(timer.current), flush())), [flush]);
  // Persist pending edits when the tab is hidden or closed.
  useEffect(() => {
    const h = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void flush();
      }
    };
    window.addEventListener("pagehide", h);
    document.addEventListener("visibilitychange", h);
    return () => {
      window.removeEventListener("pagehide", h);
      document.removeEventListener("visibilitychange", h);
    };
  }, [flush]);

  const reloadDocs = useCallback(async () => setDocs(await listDocs(id)), [id]);
  const remerge = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      await flush();
    }
    const p = await remergeProject(id);
    if (p) {
      latest.current = p;
      setProject(p);
    }
    setDocs(await listDocs(id));
  }, [id, flush]);

  const analysis = useMemo(() => (project ? analyze(project, docs) : null), [project, docs]);

  // Seed valuation assumptions from history once annual data exists (disclosed on the Valuation page).
  useEffect(() => {
    if (!project || !analysis || project.settings.valuation.seeded || analysis.fys.length === 0) return;
    if (!analysis.view.get(analysis.fys[analysis.fys.length - 1], "revenue")) return;
    const seed = seedScenarios(analysis.view, analysis.fys);
    update((p) => ({ ...p, settings: { ...p.settings, valuation: { ...p.settings.valuation, scenarios: seed.scenarios, seeded: true } } }));
  }, [project, analysis, update]);

  const fyRange = useMemo(() => {
    if (!analysis || !project) return [];
    const from = project.ui.fyFrom;
    const to = project.ui.fyTo;
    return analysis.fys.filter((f) => (!from || f >= from) && (!to || f <= to));
  }, [analysis, project]);

  if (error) return <div className="mx-auto mt-20 max-w-lg rounded-xl border border-red-200 bg-neg-soft p-6 text-sm text-neg">{error} <a className="ml-1 underline" href="/">Back to projects</a></div>;
  if (!project || !analysis) return <div className="mt-24 text-center text-sm text-ink-soft">Loading project…</div>;
  return <ProjectCtx.Provider value={{ project, docs, analysis, ai, update, setDocs, reloadDocs, remerge, saving, fyRange }}>{children}</ProjectCtx.Provider>;
}
