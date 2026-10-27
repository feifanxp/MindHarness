import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, Text, as, color, config } from 'folds';
import { ImageOverlay } from '../ImageOverlay';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import * as css from './UrlPreviewCard.css';
import { tryDecodeURIComponent } from '../../utils/dom';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageViewer } from '../image-viewer';
import { onEnterOrSpace } from '../../utils/keyboard';

const linkStyles = { color: color.Success.Main };
const getScrollDirection = (scroll: HTMLElement) =>
  getComputedStyle(scroll).direction === 'rtl' ? -1 : 1;

export const UrlPreviewCard = as<'div', { url: string; ts: number }>(
  ({ url, ts, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [viewer, setViewer] = useState(false);
    const [previewStatus, loadPreview] = useAsyncCallback(
      useCallback(() => mx.getUrlPreview(url, ts), [url, ts, mx])
    );

    useEffect(() => {
      loadPreview().catch(() => undefined);
    }, [loadPreview]);

    if (previewStatus.status === AsyncStatus.Error) return null;

    const renderContent = (prev: IPreviewUrlResponse) => {
      const thumbUrl = mxcUrlToHttp(
        mx,
        prev['og:image'] || '',
        useAuthentication,
        256,
        256,
        'scale',
        false
      );

      const imgUrl = mxcUrlToHttp(mx, prev['og:image'] || '', useAuthentication);

      return (
        <>
          {thumbUrl && (
            <UrlPreviewImg
              src={thumbUrl}
              alt={prev['og:title']}
              title={prev['og:title']}
              tabIndex={0}
              onKeyDown={onEnterOrSpace(() => setViewer(true))}
              onClick={() => setViewer(true)}
            />
          )}
          {imgUrl && (
            <ImageOverlay
              src={imgUrl}
              alt={prev['og:title']}
              viewer={viewer}
              requestClose={() => {
                setViewer(false);
              }}
              renderViewer={(p) => <ImageViewer {...p} />}
            />
          )}
          <UrlPreviewContent dir="auto">
            <Text
              style={linkStyles}
              truncate
              as="a"
              href={url}
              target="_blank"
              rel="noreferrer"
              size="T200"
              priority="300"
            >
              {typeof prev['og:site_name'] === 'string' && `${prev['og:site_name']} | `}
              {tryDecodeURIComponent(url)}
            </Text>
            <Text truncate priority="400">
              <b>{prev['og:title']}</b>
            </Text>
            <Text size="T200" priority="300">
              <UrlPreviewDescription>{prev['og:description']}</UrlPreviewDescription>
            </Text>
          </UrlPreviewContent>
        </>
      );
    };

    return (
      <UrlPreview {...props} ref={ref}>
        {previewStatus.status === AsyncStatus.Success ? (
          renderContent(previewStatus.data)
        ) : (
          <Box grow="Yes" alignItems="Center" justifyContent="Center">
            <Spinner variant="Secondary" size="400" />
          </Box>
        )}
      </UrlPreview>
    );
  }
);

export const UrlPreviewHolder = as<'div'>(({ children, ...props }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ hasContent: false, back: false, front: false });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return undefined;

    const updateLayout = () => {
      const hasContent = content.childElementCount > 0;
      const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const direction = getScrollDirection(scroll);
      // Clamp elastic overscroll (Safari) and tolerate rounded scroll dimensions.
      const position = Math.max(0, Math.min(maxScroll, direction * scroll.scrollLeft));
      const overflow = hasContent && scroll.clientWidth > 0 && maxScroll > 1;
      const back = overflow && position > 1;
      const front = overflow && position < maxScroll - 1;
      setLayout((previous) =>
        previous.hasContent === hasContent && previous.back === back && previous.front === front
          ? previous
          : { hasContent, back, front }
      );
    };

    // The content can shrink independently when preview requests fail and cards return null.
    const observer = new ResizeObserver(updateLayout);
    observer.observe(scroll);
    observer.observe(content);
    scroll.addEventListener('scroll', updateLayout, { passive: true });
    updateLayout();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', updateLayout);
    };
  }, []);

  const handleScrollBack = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    const direction = getScrollDirection(scroll);
    scroll.scrollTo({
      left: scrollLeft - (direction * offsetWidth) / 1.3,
      behavior: 'smooth',
    });
  };
  const handleScrollFront = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    const direction = getScrollDirection(scroll);
    scroll.scrollTo({
      left: scrollLeft + (direction * offsetWidth) / 1.3,
      behavior: 'smooth',
    });
  };

  return (
    <Box
      direction="Column"
      {...props}
      ref={ref}
      style={{ marginTop: layout.hasContent ? config.space.S200 : 0, position: 'relative' }}
    >
      {layout.back && (
        <>
          <div className={css.UrlPreviewHolderGradient({ position: 'Left' })} />
          <IconButton
            className={css.UrlPreviewHolderBtn({ position: 'Left' })}
            variant="Secondary"
            radii="Pill"
            size="300"
            outlined
            onClick={handleScrollBack}
          >
            <Icon data-directional size="300" src={Icons.ArrowLeft} />
          </IconButton>
        </>
      )}
      <Scroll ref={scrollRef} direction="Horizontal" size="0" visibility="Hover" hideTrack>
        <Box
          ref={contentRef}
          shrink="No"
          alignItems="Center"
          gap="200"
          style={{ width: 'max-content' }}
        >
          {children}
        </Box>
      </Scroll>
      {layout.front && (
        <>
          <div className={css.UrlPreviewHolderGradient({ position: 'Right' })} />
          <IconButton
            className={css.UrlPreviewHolderBtn({ position: 'Right' })}
            variant="Primary"
            radii="Pill"
            size="300"
            outlined
            onClick={handleScrollFront}
          >
            <Icon data-directional size="300" src={Icons.ArrowRight} />
          </IconButton>
        </>
      )}
    </Box>
  );
});
