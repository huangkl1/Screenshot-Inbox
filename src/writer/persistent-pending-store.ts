import type {
  PendingInsertRecord,
  PendingInsertStore
} from "./capture-writer";

export class PersistentPendingInsertStore implements PendingInsertStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly load: () => PendingInsertRecord[],
    private readonly persist: (records: PendingInsertRecord[]) => Promise<void>,
    private readonly createId: () => string = () => `pending-${crypto.randomUUID()}`
  ) {}

  async save(
    record: Omit<PendingInsertRecord, "id" | "completed">
  ): Promise<string> {
    let id = "";
    await this.mutate(records => {
      do id = this.createId(); while (records.some(candidate => candidate.id === id));
      records.push({ ...record, id, completed: false });
    });
    return id;
  }

  async get(id: string): Promise<PendingInsertRecord | undefined> {
    await this.mutationTail.catch(() => undefined);
    const record = this.load().find(candidate => candidate.id === id);
    return record ? { ...record } : undefined;
  }

  async list(): Promise<PendingInsertRecord[]> {
    await this.mutationTail.catch(() => undefined);
    return this.load().map(record => ({ ...record }));
  }

  async markCompleted(
    id: string,
    resolved?: Pick<PendingInsertRecord, "targetNotePath" | "embed">
  ): Promise<void> {
    await this.mutate(records => {
      const index = records.findIndex(record => record.id === id);
      if (index < 0) throw new Error(`Unknown pending insert: ${id}`);
      records[index] = { ...records[index], ...resolved, completed: true };
    });
  }

  private mutate(change: (records: PendingInsertRecord[]) => void): Promise<void> {
    const operation = this.mutationTail
      .catch(() => undefined)
      .then(async () => {
        const records = this.load().map(record => ({ ...record }));
        change(records);
        await this.persist(records);
      });
    this.mutationTail = operation;
    return operation;
  }
}
