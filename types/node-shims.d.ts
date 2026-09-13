/**
 * Minimal ambient type declarations for the Node.js built-ins used by this
 * project.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The sandbox network mode is INTEGRATIONS_ONLY: the public npm registry
 * returns HTTP 403, so `@types/node` cannot be installed. Node v22 runs the
 * `.ts` sources directly via native type-stripping (it ignores types entirely
 * at runtime), but `tsc --noEmit` still needs declarations for the built-in
 * modules we import (`node:test`, `node:assert/strict`, `node:process`).
 *
 * These declarations intentionally cover ONLY the surface this project uses.
 * They are hand-written, zero-dependency, and checked in. If a future feature
 * needs more of the Node API, extend this file rather than adding an npm
 * dependency.
 */

declare module 'node:test' {
  interface TestContext {
    diagnostic(message: string): void;
    readonly name: string;
    /** Mark the current test as TODO (reported as a known pending item). */
    todo(message?: string): void;
    /** Skip the current test at runtime. */
    skip(message?: string): void;
  }

  type TestFn = (t: TestContext) => void | Promise<void>;

  export function test(name: string, fn: TestFn): void;
  export function test(name: string): void;
  export function it(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function before(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface AssertStrict {
    (value: unknown, message?: string | Error): asserts value;
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): asserts value;
    strictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    throws(
      fn: () => unknown,
      expected?: string | Error | RegExp | ((err: unknown) => boolean) | (new (...args: never[]) => Error),
      message?: string | Error,
    ): void;
    doesNotThrow(fn: () => unknown, message?: string | Error): void;
    fail(message?: string | Error): never;
    match(value: string, regexp: RegExp, message?: string | Error): void;
  }

  const assert: AssertStrict;
  export default assert;
}

/**
 * `structuredClone` is a Node/global built-in (Node ≥ 17). Declared here (not
 * in a module) so tests can deep-clone a logical model without an npm dep.
 */
declare function structuredClone<T>(value: T): T;

declare module 'node:process' {
  interface Process {
    argv: string[];
    exit(code?: number): never;
    readonly env: Record<string, string | undefined>;
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
  }
  const process: Process;
  export default process;
}
