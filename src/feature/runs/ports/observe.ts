/** The observers look at the incidents of the runs once, however many changes arrive meanwhile. */
export interface ObservePort {
  request(): void;
}
