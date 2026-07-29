export type MemoryKind = "preference" | "profile" | "project" | "instruction";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  keywords: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  text: string;
  keywords: string[];
  confidence: number;
}
