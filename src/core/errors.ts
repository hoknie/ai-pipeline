export class Rejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Rejection';
  }
}
