export type ReplaceCallback<R> = (
  match: RegExpExecArray | RegExpMatchArray,
  pushIndex: number
) => R;
export type ConvertPartCallback<R> = (text: string, pushIndex: number) => R;

/**
 * Replaces the matches of `regex` in `text`, or its first match if `regex` is not global,
 * converting the text between them. Matches that start where `skipMatchAt` returns true are
 * left as text.
 */
export const findAndReplace = <ReplaceReturnType, ConvertReturnType>(
  text: string,
  regex: RegExp,
  replace: ReplaceCallback<ReplaceReturnType>,
  convertPart: ConvertPartCallback<ConvertReturnType>,
  skipMatchAt?: (index: number) => boolean
): Array<ReplaceReturnType | ConvertReturnType> => {
  const result: Array<ReplaceReturnType | ConvertReturnType> = [];
  let lastEnd = 0;

  let match: RegExpExecArray | RegExpMatchArray | null = regex.exec(text);
  while (match !== null && typeof match.index === 'number') {
    if (skipMatchAt?.(match.index)) {
      if (!regex.global) break;
      regex.lastIndex = match.index + 1;
      match = regex.exec(text);
      continue;
    }
    result.push(convertPart(text.slice(lastEnd, match.index), result.length));
    result.push(replace(match, result.length));

    lastEnd = match.index + match[0].length;
    match = regex.global ? regex.exec(text) : null;
  }

  result.push(convertPart(text.slice(lastEnd), result.length));

  return result;
};
