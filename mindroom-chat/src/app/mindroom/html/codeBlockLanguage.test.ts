import { describe, expect, it } from 'vitest';
import { getCodeBlockLanguage, getCodeBlockLanguageIconToken } from './codeBlockLanguage';

describe('getCodeBlockLanguage', () => {
  it('reads the language from the fence class', () => {
    expect(getCodeBlockLanguage('language-ts')).toBe('ts');
    expect(getCodeBlockLanguage('python')).toBe('python');
    expect(getCodeBlockLanguage('language-')).toBeUndefined();
    expect(getCodeBlockLanguage(undefined)).toBeUndefined();
  });
});

describe('getCodeBlockLanguageIconToken', () => {
  it('resolves languages, aliases, and extensions like T3 Code', () => {
    expect(getCodeBlockLanguageIconToken('bash')).toBe('bash');
    expect(getCodeBlockLanguageIconToken('Shell')).toBe('bash');
    expect(getCodeBlockLanguageIconToken('tsx')).toBe('react');
    expect(getCodeBlockLanguageIconToken('scss')).toBe('sass');
    expect(getCodeBlockLanguageIconToken('yaml')).toBe('yml');
    expect(getCodeBlockLanguageIconToken('Dockerfile')).toBe('docker');
  });

  it('has no icon for unknown languages or object prototype keys', () => {
    expect(getCodeBlockLanguageIconToken('elixir')).toBeUndefined();
    expect(getCodeBlockLanguageIconToken('constructor')).toBeUndefined();
  });
});
