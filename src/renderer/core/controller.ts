export interface Controller {
  init(): void | Promise<void>;
  dispose(): void;
}
