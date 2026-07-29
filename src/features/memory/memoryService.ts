import { extractMemoryCandidates } from "./memoryExtractor";
import { recallMemories } from "./memoryRecall";
import { MemoryStore } from "./memoryStore";
import type { MemoryRecord } from "./types";

export class MemoryService {
  constructor(private readonly store = new MemoryStore()) {}

  load(): MemoryRecord[] {
    return this.store.load();
  }

  rememberFromInput(input: string): MemoryRecord[] {
    const candidates = extractMemoryCandidates(input);
    if (candidates.length === 0) {
      return this.load();
    }

    const records = candidates.reduce(
      (currentRecords, candidate) =>
        this.store.upsert(currentRecords, candidate),
      this.load(),
    );

    this.store.save(records);
    return records;
  }

  recall(records: MemoryRecord[], query: string): MemoryRecord[] {
    return recallMemories(records, query);
  }

  search(query: string): MemoryRecord[] {
    return recallMemories(this.load(), query);
  }

  clear(): MemoryRecord[] {
    this.store.clear();
    return [];
  }

  deleteById(memoryId: string): MemoryRecord[] {
    return this.store.deleteById(this.load(), memoryId);
  }
}
