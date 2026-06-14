// Vite/Vitest `?raw` imports load a file's contents as a string. Used by fixture-based
// contract tests so we read real HTML/JSON without a Node fs dependency in the typecheck.
declare module "*?raw" {
  const content: string;
  export default content;
}
