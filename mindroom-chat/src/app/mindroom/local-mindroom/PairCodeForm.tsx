import React, { type ChangeEventHandler, type FormEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Text, color } from 'folds';
import { normalizePairCode } from './devicePairing';

type PairCodeFormProps = {
  defaultValue?: string;
  onSubmit: (pairCode: string) => void;
  inputId?: string;
};

export function PairCodeForm({ defaultValue = '', onSubmit, inputId }: PairCodeFormProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [invalid, setInvalid] = useState(false);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setValue(evt.currentTarget.value);
    setInvalid(false);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const pairCode = normalizePairCode(value);
    if (!pairCode) {
      setInvalid(true);
      return;
    }
    onSubmit(pairCode);
  };

  return (
    <Box as="form" direction="Column" gap="200" onSubmit={handleSubmit}>
      <Box gap="200">
        <Box grow="Yes" direction="Column">
          <Input
            id={inputId}
            name="pairCode"
            value={value}
            onChange={handleChange}
            placeholder="ABCD-EFGH"
            aria-label={t('mindroomUi.local-mindroom.localMindroom.pairCode')}
            aria-invalid={invalid}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            variant="Secondary"
            radii="300"
          />
        </Box>
        <Button type="submit" size="400" variant="Primary" radii="300" fill="Soft" outlined>
          <Text size="B400">{t('mindroomUi.local-mindroom.connect.continue')}</Text>
        </Button>
      </Box>
      {invalid && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.local-mindroom.connect.invalidCode')}
        </Text>
      )}
    </Box>
  );
}
