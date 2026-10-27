import React, { useEffect, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/matrix';
import * as css from './ModelPicker.css';
import { ProviderModelIcon } from './ProviderModelIcon';

type ModelIconProps = {
  provider?: string;
  id?: string;
  iconUrl?: string;
  size: number;
  className?: string;
};

export function ModelIcon({ provider, id, iconUrl, size, className }: ModelIconProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const mediaUrl = iconUrl
    ? mxcUrlToHttp(mx, iconUrl, useAuthentication, size * 2, size * 2, 'scale') ?? undefined
    : undefined;
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => setFailedUrl(undefined), [mediaUrl]);

  if (mediaUrl && failedUrl !== mediaUrl) {
    return (
      <img
        className={[css.IconImage, className].filter(Boolean).join(' ')}
        src={mediaUrl}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        onError={() => setFailedUrl(mediaUrl)}
      />
    );
  }

  return <ProviderModelIcon provider={provider} id={id} size={size} className={className} />;
}
