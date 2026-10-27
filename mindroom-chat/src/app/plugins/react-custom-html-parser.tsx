/* eslint-disable jsx-a11y/alt-text */
import React, {
  ComponentPropsWithoutRef,
  ReactEventHandler,
  ReactNode,
  Suspense,
  lazy,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Element,
  Text as DOMText,
  HTMLReactParserOptions,
  attributesToProps,
  domToReact,
} from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Box, config, Text, toRem, Tooltip, TooltipProvider } from 'folds';
import { IntermediateRepresentation, Opts as LinkifyOpts, OptFn } from 'linkifyjs';
import { ErrorBoundary } from 'react-error-boundary';
import { ChildNode } from 'domhandler';
import * as css from '../styles/CustomHtml.css';
import { renderMindroomCustomHtmlElement } from '../mindroom/html/customHtmlRenderers';
import {
  CheckIcon,
  CodeBlockLanguageIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  WrapTextIcon,
} from '../mindroom/html/CodeBlockIcons';
import {
  getCodeBlockLanguage,
  getCodeBlockLanguageIconToken,
} from '../mindroom/html/codeBlockLanguage';
import { renderTextWithMatrixMath } from '../mindroom/html/matrixMath';
import {
  getMxIdLocalPart,
  getCanonicalAliasRoomId,
  isRoomAlias,
  mxcUrlToHttp,
} from '../utils/matrix';
import { getMemberDisplayName } from '../utils/room';
import { createInsideUrlTest, EMOJI_PATTERN, sanitizeForRegex } from '../utils/regex';
import { getHexcodeForEmoji, getShortcodeFor } from './emoji';
import { findAndReplace } from '../utils/findAndReplace';
import {
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  parseMatrixToUser,
  testMatrixTo,
} from './matrix-to';
import { onEnterOrSpace } from '../utils/keyboard';
import { copyToClipboard, tryDecodeURIComponent } from '../utils/dom';
import { useTimeoutToggle } from '../hooks/useTimeoutToggle';
import { LinkFaviconContext, MessageLink } from '../mindroom/messages/MessageLink';
import { containsSpoiler } from '../mindroom/messages/linkFaviconPolicy';

const ReactPrism = lazy(() => import('./react-prism/ReactPrism'));

const EMOJI_REG_G = new RegExp(`(${EMOJI_PATTERN})`, 'g');
const TABLE_STRUCTURE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

const hasAncestorTag = (node: ChildNode, tagName: string): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (ancestor instanceof Element && ancestor.name === tagName) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

export const LINKIFY_OPTS: LinkifyOpts = {
  attributes: {
    target: '_blank',
    rel: 'noreferrer noopener',
  },
  validate: {
    url: (value) => /^(https|http|ftp|mailto|magnet)?:/.test(value),
  },
  ignoreTags: ['span'],
};

export const makeMentionCustomProps = (
  handleMentionClick?: ReactEventHandler<HTMLElement>,
  content?: string
): ComponentPropsWithoutRef<'a'> => ({
  style: { cursor: 'pointer' },
  target: '_blank',
  rel: 'noreferrer noopener',
  role: 'link',
  tabIndex: handleMentionClick ? 0 : -1,
  onKeyDown: handleMentionClick ? onEnterOrSpace(handleMentionClick) : undefined,
  onClick: handleMentionClick,
  children: content,
});

export const renderMatrixMention = (
  mx: MatrixClient,
  currentRoomId: string | undefined,
  href: string,
  customProps: ComponentPropsWithoutRef<'a'>
) => {
  const userId = parseMatrixToUser(href);
  if (userId) {
    const currentRoom = mx.getRoom(currentRoomId);

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({ highlight: mx.getUserId() === userId })}
        data-mention-id={userId}
      >
        {`@${
          (currentRoom && getMemberDisplayName(currentRoom, userId)) ?? getMxIdLocalPart(userId)
        }`}
      </a>
    );
  }

  const matrixToRoom = parseMatrixToRoom(href);
  if (matrixToRoom) {
    const { roomIdOrAlias, viaServers } = matrixToRoom;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias
    );

    const fallbackContent = mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias;

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({
          highlight: currentRoomId === (mentionRoom?.roomId ?? roomIdOrAlias),
        })}
        data-mention-id={mentionRoom?.roomId ?? roomIdOrAlias}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children ? customProps.children : fallbackContent}
      </a>
    );
  }

  const matrixToRoomEvent = parseMatrixToRoomEvent(href);
  if (matrixToRoomEvent) {
    const { roomIdOrAlias, eventId, viaServers } = matrixToRoomEvent;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias
    );

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({
          highlight: currentRoomId === (mentionRoom?.roomId ?? roomIdOrAlias),
        })}
        data-mention-id={mentionRoom?.roomId ?? roomIdOrAlias}
        data-mention-event-id={eventId}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children
          ? customProps.children
          : `Message: ${mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias}`}
      </a>
    );
  }

  return undefined;
};

export const factoryRenderLinkifyWithMention = (
  mentionRender: (href: string) => JSX.Element | undefined,
  showLinkFavicons = false
): OptFn<(ir: IntermediateRepresentation) => any> => {
  const render: OptFn<(ir: IntermediateRepresentation) => any> = ({
    tagName,
    attributes,
    content,
  }) => {
    if (tagName === 'a' && testMatrixTo(tryDecodeURIComponent(attributes.href))) {
      const mention = mentionRender(tryDecodeURIComponent(attributes.href));
      if (mention) return mention;
    }

    return (
      <MessageLink {...attributes} showFavicon={showLinkFavicons}>
        {content}
      </MessageLink>
    );
  };
  return render;
};

export const scaleSystemEmoji = (text: string): (string | JSX.Element)[] =>
  findAndReplace(
    text,
    EMOJI_REG_G,
    (match, pushIndex) => (
      <span key={`scaleSystemEmoji-${pushIndex}`} className={css.EmoticonBase}>
        <span className={css.Emoticon()} title={getShortcodeFor(getHexcodeForEmoji(match[0]))}>
          {match[0]}
        </span>
      </span>
    ),
    (txt) => txt,
    createInsideUrlTest(text)
  );

export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  const pattern = highlights.map(sanitizeForRegex).join('|');
  if (!pattern) return undefined;
  return new RegExp(pattern, 'gi');
};

export const highlightText = (
  regex: RegExp,
  data: (string | JSX.Element)[]
): (string | JSX.Element)[] =>
  data.flatMap((text) => {
    if (typeof text !== 'string') return text;

    return findAndReplace(
      text,
      regex,
      (match, pushIndex) => (
        <span key={`highlight-${pushIndex}`} className={css.highlightText}>
          {match[0]}
        </span>
      ),
      (txt) => txt
    );
  });

const renderStyledText = (text: string, highlightRegex?: RegExp): (string | JSX.Element)[] => {
  let jsx = scaleSystemEmoji(text);

  if (highlightRegex) {
    jsx = highlightText(highlightRegex, jsx);
  }

  return jsx;
};

export const renderTextWithLatex = (
  text: string,
  params: {
    linkify?: boolean;
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    keyPrefix?: string;
  }
): React.ReactNode =>
  renderTextWithMatrixMath(text, {
    ...params,
    renderStyledText,
  });

/**
 * Recursively extracts and concatenates all text content from an array of ChildNode objects.
 *
 * @param {ChildNode[]} nodes - An array of ChildNode objects to extract text from.
 * @returns {string} The concatenated plain text content of all descendant text nodes.
 */
const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (node.type === 'text' && typeof node.data === 'string') {
      text += node.data;
    } else if (Array.isArray((node as { children?: unknown }).children)) {
      text += extractTextFromChildren((node as { children: ChildNode[] }).children);
    }
  });

  return text;
};

function CodeBlockAction({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className={css.CodeBlockAction}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </button>
      )}
    </TooltipProvider>
  );
}

/**
 * Filename labels render icon + text. A bare language renders only its icon,
 * named in a tooltip, and falls back to the language text without one.
 */
function CodeBlockTitle({ label, language }: { label?: string; language?: string }) {
  const { t } = useTranslation();
  const iconToken = language ? getCodeBlockLanguageIconToken(language) : undefined;
  if (label) {
    return (
      <span className={css.CodeBlockLabel}>
        <CodeBlockLanguageIcon token={iconToken ?? 'default'} />
        <span className={css.CodeBlockLabelText}>{label}</span>
      </span>
    );
  }
  if (!language || !iconToken) {
    return (
      <span className={css.CodeBlockLabel}>
        <span className={css.CodeBlockLabelText}>{language ?? 'text'}</span>
      </span>
    );
  }
  return (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{language}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <span
          ref={triggerRef}
          className={css.CodeBlockLabel}
          role="img"
          aria-label={t('messageCodeBlock.language', { language })}
        >
          <CodeBlockLanguageIcon token={iconToken} />
        </span>
      )}
    </TooltipProvider>
  );
}

export function CodeBlock({
  children,
  opts,
}: {
  children: ChildNode[];
  opts: HTMLReactParserOptions;
}) {
  const { t } = useTranslation();
  const code = children[0];
  const attribs = code instanceof Element && code.name === 'code' ? code.attribs : undefined;
  const customLabel = attribs?.['data-label'];
  const language = getCodeBlockLanguage(attribs?.class);

  const LINE_LIMIT = 14;
  const text = useMemo(() => extractTextFromChildren(children), [children]);
  const [expanded, setExpand] = useState(false);
  const [wrapped, setWrapped] = useState(true);
  const [copied, setCopied] = useTimeoutToggle();
  // Wrapped, a single long line (minified JSON, a log) grows as tall as many short ones.
  const largeCodeBlock =
    text.split('\n').length > LINE_LIMIT || (wrapped && text.length > LINE_LIMIT * 80);

  const handleCopy = async () => {
    if (await copyToClipboard(text)) setCopied();
  };

  const toggleExpand = () => {
    setExpand(!expanded);
  };

  return (
    <Text
      size="T300"
      as="pre"
      className={classNames(css.CodeBlock, css.MessageCodeBlock)}
      data-wrap={wrapped}
    >
      <div className={css.CodeBlockHeader}>
        <CodeBlockTitle label={customLabel} language={language} />
        <div
          className={css.CodeBlockActions}
          role="group"
          aria-label={t('messageCodeBlock.actions', 'Code block actions')}
        >
          <CodeBlockAction
            label={t('messageCodeBlock.wrap', 'Wrap lines')}
            pressed={wrapped}
            onClick={() => setWrapped(!wrapped)}
          >
            <WrapTextIcon />
          </CodeBlockAction>
          {largeCodeBlock && (
            <CodeBlockAction
              label={
                expanded
                  ? t('messageCodeBlock.collapse', 'Collapse')
                  : t('messageCodeBlock.expand', 'Expand')
              }
              onClick={toggleExpand}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </CodeBlockAction>
          )}
          <CodeBlockAction
            label={
              copied
                ? t('messageCodeBlock.copied', 'Copied')
                : t('messageCodeBlock.copy', 'Copy code')
            }
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </CodeBlockAction>
        </div>
      </div>
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Native scroll regions need keyboard focus. */}
      <div
        className={css.CodeBlockScroll}
        role="group"
        aria-label={customLabel ?? language ?? t('messageCodeBlock.code', 'Code')}
        tabIndex={0}
        style={{
          maxHeight: largeCodeBlock && !expanded ? toRem(300) : undefined,
          paddingBottom: largeCodeBlock ? config.space.S400 : undefined,
        }}
      >
        <div id="code-block-content" className={css.CodeBlockInternal}>
          {domToReact(children, opts)}
        </div>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
      {largeCodeBlock && !expanded && <Box className={css.CodeBlockBottomShadow} />}
    </Text>
  );
}

export const getReactCustomHtmlParser = (
  mx: MatrixClient,
  roomId: string | undefined,
  params: {
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    handleSpoilerClick?: ReactEventHandler<HTMLElement>;
    handleMentionClick?: ReactEventHandler<HTMLElement>;
    useAuthentication?: boolean;
    showLinkFavicons?: boolean;
  }
): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && 'name' in domNode) {
        const { name, attribs, children, parent } = domNode;
        const props = attributesToProps(attribs);

        // Spoiler policy also applies to custom-rendered descendants and math fallbacks.
        if (name === 'span' && 'data-mx-spoiler' in props) {
          return (
            <LinkFaviconContext.Provider value={false}>
              <span
                {...props}
                role="button"
                tabIndex={params.handleSpoilerClick ? 0 : -1}
                onKeyDown={params.handleSpoilerClick}
                onClick={params.handleSpoilerClick}
                className={css.Spoiler()}
                aria-pressed
                style={{ cursor: 'pointer' }}
              >
                {renderMindroomCustomHtmlElement(name, attribs, children, opts) ??
                  domToReact(children, opts)}
              </span>
            </LinkFaviconContext.Provider>
          );
        }

        const mindroomElement = renderMindroomCustomHtmlElement(name, attribs, children, opts);
        if (mindroomElement) return mindroomElement;

        if (name === 'h1') {
          return (
            <Text {...props} className={css.Heading} size="H2">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h2') {
          return (
            <Text {...props} className={css.Heading} size="H3">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h3') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h4') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h5') {
          return (
            <Text {...props} className={css.Heading} size="H5">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h6') {
          return (
            <Text {...props} className={css.Heading} size="H6">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'p') {
          return (
            <Text {...props} className={classNames(css.Paragraph, css.MarginSpaced)} size="Inherit">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'pre') {
          return <CodeBlock opts={opts}>{children}</CodeBlock>;
        }

        if (name === 'blockquote') {
          return (
            <Text {...props} size="Inherit" as="blockquote" className={css.BlockQuote}>
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'ul') {
          return (
            <ul {...props} className={css.List}>
              {domToReact(children, opts)}
            </ul>
          );
        }
        if (name === 'ol') {
          return (
            <ol {...props} className={css.List}>
              {domToReact(children, opts)}
            </ol>
          );
        }

        if (name === 'code') {
          if (parent && 'name' in parent && parent.name === 'pre') {
            const codeReact = domToReact(children, opts);
            if (typeof codeReact === 'string') {
              let lang = props.className;
              if (lang === 'language-rs') lang = 'language-rust';
              else if (lang === 'language-js') lang = 'language-javascript';
              else if (lang === 'language-ts') lang = 'language-typescript';
              return (
                <ErrorBoundary fallback={<code {...props}>{codeReact}</code>}>
                  <Suspense fallback={<code {...props}>{codeReact}</code>}>
                    {/* Prism rewrites the element, and React's next text update erases its
                        tokens; remount on each edit so streamed code stays highlighted. */}
                    <ReactPrism key={`${lang}:${codeReact}`}>
                      {(ref) => (
                        <code ref={ref} {...props} className={lang}>
                          {codeReact}
                        </code>
                      )}
                    </ReactPrism>
                  </Suspense>
                </ErrorBoundary>
              );
            }
          } else {
            return (
              <Text as="code" size="T300" className={css.Code} {...props}>
                {domToReact(children, opts)}
              </Text>
            );
          }
        }

        if (name === 'a') {
          const href = tryDecodeURIComponent(props.href);

          if (hasAncestorTag(domNode, 'code')) {
            return <>{domToReact(children, opts)}</>;
          }

          if (testMatrixTo(href)) {
            const content = children.find((child) => !(child instanceof DOMText))
              ? undefined
              : children.map((c) => (c instanceof DOMText ? c.data : '')).join();

            const mention = renderMatrixMention(
              mx,
              roomId,
              href,
              makeMentionCustomProps(params.handleMentionClick, content)
            );

            if (mention) return mention;
          }
          return (
            <MessageLink
              {...props}
              showFavicon={params.showLinkFavicons && !containsSpoiler(children)}
            >
              {domToReact(children, opts)}
            </MessageLink>
          );
        }

        if (name === 'img') {
          const htmlSrc = mxcUrlToHttp(mx, props.src, params.useAuthentication);
          if (htmlSrc && props.src.startsWith('mxc://') === false) {
            return (
              <a href={htmlSrc} target="_blank" rel="noreferrer noopener">
                {props.alt || props.title || htmlSrc}
              </a>
            );
          }
          if (htmlSrc && 'data-mx-emoticon' in props) {
            return (
              <span className={css.EmoticonBase}>
                <span className={css.Emoticon()}>
                  <img {...props} className={css.EmoticonImg} src={htmlSrc} />
                </span>
              </span>
            );
          }
          if (htmlSrc) return <img {...props} className={css.Img} src={htmlSrc} />;
        }
      }

      if (domNode instanceof DOMText) {
        const parentName =
          domNode.parent && 'name' in domNode.parent ? domNode.parent.name : undefined;

        // React rejects whitespace text nodes directly under table structure tags.
        if (
          parentName &&
          TABLE_STRUCTURE_TAGS.has(parentName) &&
          domNode.data.trim().length === 0
        ) {
          return null;
        }

        // Fenced code stays a plain string so the code replacer can hand it to
        // Prism; a block containing a search match shows the match instead.
        if (
          parentName === 'code' &&
          hasAncestorTag(domNode, 'pre') &&
          (!params.highlightRegex || domNode.data.search(params.highlightRegex) === -1)
        ) {
          return undefined;
        }

        const insideCode = hasAncestorTag(domNode, 'code');
        const linkify = !insideCode && parentName !== 'a';
        const parseMath = !insideCode && parentName !== 'pre' && parentName !== 'a';

        if (parseMath) {
          return (
            <>
              {renderTextWithLatex(domNode.data, {
                linkify,
                linkifyOpts: params.linkifyOpts,
                highlightRegex: params.highlightRegex,
                keyPrefix: `${parentName ?? 'text'}-${domNode.startIndex ?? 0}`,
              })}
            </>
          );
        }

        return <>{renderStyledText(domNode.data, params.highlightRegex)}</>;
      }
      return undefined;
    },
  };
  return opts;
};
