import type { CodeBlockLanguageIconToken } from './codeBlockLanguageIconPaths';

// Fence languages and file extensions mapped the way @pierre/trees resolves file
// icons, with T3 Code's language aliases (`shell`, `plaintext`, ...) folded in.
const LANGUAGE_ICON_TOKENS: Record<string, CodeBlockLanguageIconToken> = {
  astro: 'astro',
  bash: 'bash',
  csh: 'bash',
  fish: 'bash',
  ksh: 'bash',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  css: 'css',
  less: 'css',
  postcss: 'css',
  styl: 'css',
  db: 'database',
  sql: 'database',
  sqlite: 'database',
  dockerfile: 'docker',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  htm: 'html',
  html: 'html',
  xhtml: 'html',
  cjs: 'javascript',
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsonl: 'json',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  pyi: 'python',
  python: 'python',
  jsx: 'react',
  tsx: 'react',
  erb: 'ruby',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  rust: 'rust',
  sass: 'sass',
  scss: 'sass',
  svelte: 'svelte',
  swift: 'swift',
  csv: 'table',
  tsv: 'table',
  tf: 'terraform',
  tfvars: 'terraform',
  cfg: 'text',
  conf: 'text',
  ini: 'text',
  log: 'text',
  plaintext: 'text',
  txt: 'text',
  cts: 'typescript',
  mts: 'typescript',
  ts: 'typescript',
  typescript: 'typescript',
  vue: 'vue',
  wasm: 'wasm',
  wat: 'wasm',
  yaml: 'yml',
  yml: 'yml',
  zig: 'zig',
};

// Pierre's file icon palette as [light, dark], matching T3 Code.
const ICON_COLORS: Record<CodeBlockLanguageIconToken, readonly [string, string]> = {
  astro: ['#a631be', '#d568ea'],
  bash: ['#199f43', '#5ecc71'],
  c: ['#1a85d4', '#69b1ff'],
  cpp: ['#1a85d4', '#69b1ff'],
  css: ['#693acf', '#9d6afb'],
  database: ['#a631be', '#d568ea'],
  default: ['#84848a', '#adadb1'],
  docker: ['#1a85d4', '#69b1ff'],
  go: ['#1ca1c7', '#68cdf2'],
  graphql: ['#d32a61', '#ff678d'],
  html: ['#d47628', '#ffa359'],
  javascript: ['#d5a910', '#ffd452'],
  json: ['#d47628', '#ffa359'],
  markdown: ['#199f43', '#5ecc71'],
  python: ['#1a85d4', '#69b1ff'],
  react: ['#1ca1c7', '#68cdf2'],
  ruby: ['#d52c36', '#ff6762'],
  rust: ['#d47628', '#ffa359'],
  sass: ['#d32a61', '#ff678d'],
  svelte: ['#d52c36', '#ff6762'],
  swift: ['#d47628', '#ffa359'],
  table: ['#17a5af', '#64d1db'],
  terraform: ['#693acf', '#9d6afb'],
  text: ['#84848a', '#adadb1'],
  typescript: ['#1a85d4', '#69b1ff'],
  vue: ['#199f43', '#5ecc71'],
  wasm: ['#693acf', '#9d6afb'],
  yml: ['#d52c36', '#ff6762'],
  zig: ['#d47628', '#ffa359'],
};

/** Reads the fence language from a `language-*` class, as the markdown rule writes it. */
export const getCodeBlockLanguage = (className: string | undefined): string | undefined => {
  const language = className?.startsWith('language-')
    ? className.slice('language-'.length)
    : className;
  return language || undefined;
};

export const getCodeBlockLanguageIconToken = (
  language: string
): CodeBlockLanguageIconToken | undefined => {
  const key = language.toLowerCase();
  return Object.prototype.hasOwnProperty.call(LANGUAGE_ICON_TOKENS, key)
    ? LANGUAGE_ICON_TOKENS[key]
    : undefined;
};

export const getCodeBlockIconColors = (
  token: CodeBlockLanguageIconToken
): readonly [light: string, dark: string] => ICON_COLORS[token];
