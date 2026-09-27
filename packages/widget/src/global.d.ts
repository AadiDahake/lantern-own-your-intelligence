/** What the widget exposes to the host page. Kept small and stable. */
type LanternApi = {
  open(): void;
  close(): void;
  ask(question: string): void;
};

interface Window {
  Lantern?: LanternApi;
}
