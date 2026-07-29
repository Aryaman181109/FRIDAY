import type { MemoryRecord } from "./types";

const MEMORY_STORAGE_KEY = "friday.memory.v1";
const MAX_MEMORY_RECORDS = 120;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `mem_${crypto.randomUUID()}`;
  }

  return `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as MemoryRecord;
  return (
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    Array.isArray(record.keywords) &&
    typeof record.confidence === "number"
  );
}

export class MemoryStore {
  load(): MemoryRecord[] {
    try {
      const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(isMemoryRecord);
    } catch {
      return [];
    }
  }

  save(records: MemoryRecord[]): void {
    const trimmedRecords = records
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_MEMORY_RECORDS);

    window.localStorage.setItem(
      MEMORY_STORAGE_KEY,
      JSON.stringify(trimmedRecords),
    );
  }

  clear(): void {
    window.localStorage.removeItem(MEMORY_STORAGE_KEY);
  }

  deleteById(records: MemoryRecord[], memoryId: string): MemoryRecord[] {
    const updatedRecords = records.filter((record) => record.id !== memoryId);
    this.save(updatedRecords);
    return updatedRecords;
  }

  upsert(
    records: MemoryRecord[],
    candidate: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">,
  ): MemoryRecord[] {
    const now = Date.now();
    const normalizedText = candidate.text.toLowerCase();
    const existingRecord = records.find(
      (record) => record.text.toLowerCase() === normalizedText,
    );

    if (existingRecord) {
      return records.map((record) =>
        record.id === existingRecord.id
          ? {
              ...record,
              confidence: Math.max(record.confidence, candidate.confidence),
              keywords: Array.from(
                new Set([...record.keywords, ...candidate.keywords]),
              ),
              updatedAt: now,
            }
          : record,
      );
    }

    return [
      ...records,
      {
        id: createId(),
        ...candidate,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
}
