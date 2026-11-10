import type { AttemptHistoryPage, AttemptHistoryQuery } from '../types/index.ts';
import { AttemptHistoryRepository } from '../repositories/index.ts';

export class RunAttemptHistoryService {
  private readonly repository: AttemptHistoryRepository;

  constructor(repository: AttemptHistoryRepository) {
    this.repository = repository;
  }

  page(query: AttemptHistoryQuery): AttemptHistoryPage {
    return this.repository.page(query);
  }
}
