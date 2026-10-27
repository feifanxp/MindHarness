import React from 'react';
import classNames from 'classnames';
import {
  ArgumentField,
  ArgumentFields,
  orderArgumentFields,
  pickPreviewFields,
  toArgumentFields,
} from './argumentFields';
import * as css from './ApprovalArgumentFields.css';

// A clamped preview shows each value on its own lines, so blank lines would hide the text.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function FieldRows({ fields, clamp }: { fields: ArgumentField[]; clamp: boolean }) {
  const shown = (text: string) => (clamp ? oneLine(text) : text);
  return (
    <dl className={css.Fields}>
      {fields.map(({ key, value }) => (
        <React.Fragment key={key}>
          <dt className={css.Key}>{key}</dt>
          <dd className={css.Value}>
            {value.kind === 'nested' ? (
              <FieldRows fields={value.fields} clamp={clamp} />
            ) : value.kind === 'json' ? (
              <pre className={classNames(css.Code, clamp && css.Clamped)}>{shown(value.text)}</pre>
            ) : (
              <span
                className={classNames(value.kind === 'scalar' && css.Scalar, clamp && css.Clamped)}
              >
                {shown(value.text)}
              </span>
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Tool arguments as labeled fields; `limit` shows a clamped preview of the most telling fields. */
export function ApprovalArgumentFields({
  value,
  limit,
  parse = toArgumentFields,
}: {
  value: unknown;
  limit?: number;
  parse?: (value: unknown) => ArgumentFields;
}) {
  const parsed = parse(value);
  if ('raw' in parsed) {
    return parsed.raw ? (
      <pre className={classNames(css.Code, limit !== undefined && css.Clamped)}>
        {limit === undefined ? parsed.raw : oneLine(parsed.raw)}
      </pre>
    ) : null;
  }
  const fields =
    limit === undefined
      ? orderArgumentFields(parsed.fields)
      : pickPreviewFields(parsed.fields, limit);
  return fields.length > 0 ? <FieldRows fields={fields} clamp={limit !== undefined} /> : null;
}

export const countArgumentFields = (value: unknown): number => {
  const parsed = toArgumentFields(value);
  return 'fields' in parsed ? parsed.fields.length : 0;
};
