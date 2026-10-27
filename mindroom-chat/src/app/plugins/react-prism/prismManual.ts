// Unless it runs in manual mode, Prism highlights every `code[class*=language-]`
// in the document a frame after it loads, rewriting elements React owns (search
// results with match highlights among them). Import this before `prismjs`.
const scope = globalThis as { Prism?: { manual?: boolean } };
scope.Prism = scope.Prism ?? {};
scope.Prism.manual = true;

export {};
