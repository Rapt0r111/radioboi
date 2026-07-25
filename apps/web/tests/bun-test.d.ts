declare module "bun:test" {
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: any;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
}
