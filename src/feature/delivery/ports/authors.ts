/** Who a user is for a commit: the name and the email of the author of a run. */
export interface DeliveryAuthorsPort {
  /** The name and the email of the user, or `null` for an id nobody knows. */
  byId(id: string): { name: string; email: string } | null;
}
