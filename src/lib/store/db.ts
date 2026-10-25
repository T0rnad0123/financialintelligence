"use client";
// Local persistence in the browser (IndexedDB). Nothing here leaves the device.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocMeta, Excerpt, ExtractedFact, PageInfo, Project, ProjectSummary, StrategyItem } from "../types";
import type { ProcessResult } from "../extraction/processor";
import { migrateProject } from "../project";

export interface DocData {
  docId: string;
  pages: PageInfo[];
  facts: ExtractedFact[];
  segments: ProcessResult["segments"];
  excerpts: Excerpt[];
  strategyCandidates: StrategyItem[];
}

interface FilDB extends DBSchema {
  projects: { key: string; value: Project };
  documents: { key: string; value: DocMeta; indexes: { byProject: string } };
  docData: { key: string; value: DocData };
  blobs: { key: string; value: { docId: string; blob: Blob } };
}

let dbp: Promise<IDBPDatabase<FilDB>> | null = null;

function db() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available in this browser (private mode or storage disabled). Projects cannot be saved.");
  if (!dbp) {
    dbp = openDB<FilDB>("financial-intelligence-lab", 1, {
      upgrade(d) {
        d.createObjectStore("projects", { keyPath: "id" });
        const docs = d.createObjectStore("documents", { keyPath: "id" });
        docs.createIndex("byProject", "projectId");
        d.createObjectStore("docData", { keyPath: "docId" });
        d.createObjectStore("blobs", { keyPath: "docId" });
      },
    });
  }
  return dbp;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const d = await db();
  const all = await d.getAll("projects");
  const out: ProjectSummary[] = [];
  for (const p of all) {
    const count = await d.countFromIndex("documents", "byProject", p.id);
    out.push({ id: p.id, name: p.name, sector: p.sector, nseSymbol: p.nseSymbol, updatedAt: p.updatedAt, docCount: count });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const p = await (await db()).get("projects", id);
  return p ? migrateProject(p) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  await (await db()).put("projects", { ...p, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const docs = await d.getAllFromIndex("documents", "byProject", id);
  const tx = d.transaction(["projects", "documents", "docData", "blobs"], "readwrite");
  for (const doc of docs) {
    await tx.objectStore("documents").delete(doc.id);
    await tx.objectStore("docData").delete(doc.id);
    await tx.objectStore("blobs").delete(doc.id);
  }
  await tx.objectStore("projects").delete(id);
  await tx.done;
}

export async function listDocs(projectId: string): Promise<DocMeta[]> {
  const docs = await (await db()).getAllFromIndex("documents", "byProject", projectId);
  return docs.sort((a, b) => a.uploadedAt - b.uploadedAt);
}

export async function saveDoc(doc: DocMeta): Promise<void> {
  await (await db()).put("documents", doc);
}

export async function getDoc(id: string): Promise<DocMeta | undefined> {
  return (await db()).get("documents", id);
}

export async function deleteDoc(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["documents", "docData", "blobs"], "readwrite");
  await tx.objectStore("documents").delete(id);
  await tx.objectStore("docData").delete(id);
  await tx.objectStore("blobs").delete(id);
  await tx.done;
}

export async function saveDocData(data: DocData): Promise<void> {
  await (await db()).put("docData", data);
}

export async function getDocData(docId: string): Promise<DocData | undefined> {
  return (await db()).get("docData", docId);
}

export async function saveBlob(docId: string, blob: Blob): Promise<void> {
  await (await db()).put("blobs", { docId, blob });
}

export async function getBlob(docId: string): Promise<Blob | undefined> {
  return (await (await db()).get("blobs", docId))?.blob;
}

export interface ProjectBackup {
  format: "financial-intelligence-lab-backup";
  version: 1;
  exportedAt: string;
  project: Project;
  documents: DocMeta[];
  docData: DocData[];
  note: string;
}

export async function exportProject(id: string): Promise<ProjectBackup> {
  const project = await getProject(id);
  if (!project) throw new Error("Project not found.");
  const documents = await listDocs(id);
  const docData: DocData[] = [];
  for (const d of documents) {
    const dd = await getDocData(d.id);
    if (dd) docData.push(dd);
  }
  return {
    format: "financial-intelligence-lab-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    documents: documents.map((d) => ({ ...d, blobStored: false })),
    docData,
    note: "Contains extracted text, figures and assumptions. Original PDF files are not included — re-upload them to reprocess.",
  };
}

export async function importProject(raw: unknown): Promise<string> {
  const b = raw as ProjectBackup;
  if (!b || b.format !== "financial-intelligence-lab-backup" || !b.project?.id) throw new Error("Not a Financial Intelligence Lab backup file.");
  const d = await db();
  const exists = await d.get("projects", b.project.id);
  const newId = exists ? `${b.project.id}_imp${Date.now().toString(36)}` : b.project.id;
  const idMap = new Map<string, string>();
  const tx = d.transaction(["projects", "documents", "docData"], "readwrite");
  for (const doc of b.documents ?? []) {
    const nid = exists ? `${doc.id}_imp${Date.now().toString(36)}` : doc.id;
    idMap.set(doc.id, nid);
    await tx.objectStore("documents").put({ ...doc, id: nid, projectId: newId, blobStored: false });
  }
  for (const dd of b.docData ?? []) {
    const nid = idMap.get(dd.docId);
    if (nid) await tx.objectStore("docData").put({ ...dd, docId: nid });
  }
  await tx.objectStore("projects").put(migrateProject({ ...b.project, id: newId, name: exists ? `${b.project.name} (imported)` : b.project.name }));
  await tx.done;
  return newId;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}
