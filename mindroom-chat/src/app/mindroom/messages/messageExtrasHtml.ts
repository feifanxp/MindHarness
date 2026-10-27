import sanitizeHtml, { type Attributes, type Transformer } from 'sanitize-html';

const MAX_TAG_NESTING = 100;

const SAFE_HREF_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const allowedTags = [
  'p',
  'div',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'br',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'pre',
  'code',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'sup',
  'sub',
  'a',
];

// sanitize-html does not track SVG parent context. title/desc are kept as inert
// text labels for accessible inline SVG, and remain inert if they appear outside SVG.
const svgTags = [
  'svg',
  'g',
  'defs',
  'marker',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
];

const svgMixedCaseAttributeNames: Record<string, string> = {
  markerheight: 'markerHeight',
  markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  preserveaspectratio: 'preserveAspectRatio',
  refx: 'refX',
  refy: 'refY',
  viewbox: 'viewBox',
};

const svgAttributes = [
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-family',
  'font-weight',
  'marker-end',
  'marker-start',
  'marker-mid',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'markerUnits',
  'preserveAspectRatio',
  'id',
  'class',
];

const allowedSvgAttributes = Object.fromEntries(
  svgTags.map((tag) => [tag, svgAttributes])
) as Record<string, string[]>;

const SAFE_SVG_CLASS_PATTERN = /^[A-Za-z_][\w:-]*$/;

const allowedSvgClasses = Object.fromEntries(
  svgTags.map((tag) => [tag, [SAFE_SVG_CLASS_PATTERN]])
) as Record<string, RegExp[]>;

const svgTransformTags = Object.fromEntries(svgTags.map((tag) => [tag, transformSvgTag])) as Record<
  string,
  Transformer
>;

const forbiddenSvgTags = [
  'foreignObject',
  'foreignobject',
  'use',
  'image',
  'animate',
  'animateTransform',
  'animatetransform',
  'animateMotion',
  'animatemotion',
  'set',
];

const forbiddenSvgAttributes = new Set(['href', 'xlink:href', 'style']);

const SVG_URL_REFERENCE_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

const nonTextTags = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'meta',
  'link',
  'base',
  'noscript',
  'mx-reply',
  'details',
  'summary',
  'img',
  'think',
  'debug',
  'system',
  'plan',
  'analysis',
  'research',
  ...forbiddenSvgTags,
];

const hasRawWhitespace = (value: string): boolean => /\s/.test(value);

const isSafeHref = (href: string): boolean => {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('//') || hasRawWhitespace(trimmedHref)) {
    return false;
  }

  try {
    const url = new URL(trimmedHref);
    return SAFE_HREF_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
};

const transformAnchorTag: Transformer = (tagName, attribs) => {
  const href = attribs.href;
  if (typeof href !== 'string' || !isSafeHref(href)) {
    return {
      tagName,
      attribs: {} as Attributes,
    };
  }

  return {
    tagName,
    attribs: {
      href: href.trim(),
      target: '_blank',
      rel: 'noreferrer noopener',
    },
  };
};

function transformSvgTag(tagName: string, attribs: Attributes) {
  const sanitizedAttributes: Attributes = {};

  for (const [attrName, attrValue] of Object.entries(attribs)) {
    const normalizedAttrName = attrName.toLowerCase();
    if (normalizedAttrName.startsWith('on') || forbiddenSvgAttributes.has(normalizedAttrName)) {
      continue;
    }
    if (hasUnsafeSvgUrlReference(attrValue)) {
      continue;
    }
    const safeAttrName = svgMixedCaseAttributeNames[normalizedAttrName] ?? attrName;
    sanitizedAttributes[safeAttrName] = attrValue;
  }

  return {
    tagName,
    attribs: sanitizedAttributes,
  };
}

const hasUnsafeSvgUrlReference = (value: string): boolean => {
  SVG_URL_REFERENCE_PATTERN.lastIndex = 0;
  for (
    let match = SVG_URL_REFERENCE_PATTERN.exec(value);
    match !== null;
    match = SVG_URL_REFERENCE_PATTERN.exec(value)
  ) {
    const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!target.startsWith('#')) return true;
  }
  return false;
};

export const sanitizeMindroomMessageExtraHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...allowedTags, ...svgTags],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      ol: ['start', 'type'],
      code: ['class'],
      pre: ['class'],
      ...allowedSvgAttributes,
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto'],
    },
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    allowedClasses: {
      code: ['language-*'],
      pre: ['language-*'],
      ...allowedSvgClasses,
    },
    transformTags: {
      a: transformAnchorTag,
      ...svgTransformTags,
    },
    nonTextTags,
    nestingLimit: MAX_TAG_NESTING,
  });
