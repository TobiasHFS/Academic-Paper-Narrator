export interface ExtractionPageInput {
  pageNum: number;
  base64Image: string;
  rawText: string;
  realPageNum?: number;
  previousRawText?: string;
  nextRawText?: string;
}

type CleanExtractedPageOptions = Pick<ExtractionPageInput, 'rawText' | 'pageNum' | 'realPageNum'> & {
  source?: 'ai' | 'raw';
};

const DEFAULT_CONTEXT_CHARS = 1400;
const DEFAULT_TTS_CHUNK_CHARS = 1200;

const normalizeWhitespace = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\ufeff/g, '');

export const textHead = (text = '', maxChars = DEFAULT_CONTEXT_CHARS): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars).trim() : normalized;
};

export const textTail = (text = '', maxChars = DEFAULT_CONTEXT_CHARS): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? normalized.slice(-maxChars).trim() : normalized;
};

export const cleanNarrativeText = (input: string): string => {
  let text = normalizeWhitespace(input || '');

  text = text
    .replace(/```(?:markdown|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/\[\[(?:EMPTY|SKIPPED_SECTION)\]\]/g, '')
    .replace(/---\s*PAGE_BREAK\s*---/gi, '')
    .replace(/^\s*(?:here is|here's)\s+(?:the\s+)?(?:script|narration|transcript)[^\n]*\n?/i, '')
    .replace(/^\s*(?:hier ist|hier kommt)\s+(?:das\s+)?(?:skript|transkript)[^\n]*\n?/i, '')
    .replace(/^\s*[-_]{3,}\s*$/gm, '')
    .replace(/^\s*(?:page|seite)\s+\d+\s*(?:of\s+\d+)?\s*$/gim, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^\s*\d{2,5}\s+[A-Z][A-Z0-9\s,.'\u2019&:;-]{12,}\s*$/gm, '')
    .replace(/^\s*[A-Z][A-Z0-9\s,.'\u2019&:;-]{12,}\s+\d{2,5}\s*$/gm, '')
    .replace(/^\s*(?:\u00a9|\(c\)|copyright)\s*\d{4}[^\n]*$/gim, '');

  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
};

const normalizeForMatch = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[$\\{}_^]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isLikelySectionHeading = (line: string): boolean =>
  /^(?:#{1,3}\s*)?(?:[ivxlcdm]+\.|\d+(?:\.\d+)*\.?)\s+/i.test(line)
  || /^(?:#{1,3}\s*)?(abstract|introduction|conclusion|references|appendix|proof|lemma|theorem|definition|results|discussion)\b/i.test(line);

const stripLikelyRunningHeaders = (text: string, pageNum?: number): string => {
  const isBeyondFirstPage = (pageNum || 1) > 1;
  if (!isBeyondFirstPage) return text;

  return text
    .split('\n')
    .filter(line => {
      const stripped = line.replace(/^#{1,6}\s*/, '').trim();
      const letters = stripped.replace(/[^A-Za-z]/g, '');
      const words = stripped.split(/\s+/).filter(Boolean);
      const isUppercaseLine =
        letters.length >= 8
        && stripped === stripped.toUpperCase()
        && /^[A-Z0-9\s,.'\u2019&:;-]+$/.test(stripped)
        && words.length <= 8;

      return !isUppercaseLine || isLikelySectionHeading(stripped);
    })
    .join('\n');
};

const extractLateRawFootnoteCandidates = (rawText = ''): string[] => {
  const raw = rawText.replace(/\s+/g, ' ').trim();
  if (raw.length < 160) return [];

  const tail = raw.slice(Math.floor(raw.length * 0.55));
  const candidates: string[] = [];
  const pattern = /(?:^|\s)(\d{1,2})(?:[.)])?\s+([A-Z][\s\S]{50,520}?)(?=(?:\s\d{1,2}(?:[.)])?\s+[A-Z])|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(tail)) !== null) {
    const candidate = match[2].replace(/\s+/g, ' ').trim();
    if (candidate.length >= 50) candidates.push(candidate);
  }

  return candidates;
};

const stripFootnoteParagraphsFromRaw = (text: string, rawText?: string): string => {
  const footnoteCandidates = extractLateRawFootnoteCandidates(rawText);
  if (footnoteCandidates.length === 0 && !/^\s*\d{1,2}(?:[.)])?\s+[A-Z]/m.test(text)) return text;

  const normalizedCandidates = footnoteCandidates.map(normalizeForMatch).filter(Boolean);

  return text
    .split(/\n{2,}/)
    .filter(paragraph => {
      const trimmed = paragraph.trim();
      if (/^\d{1,2}(?:[.)])?\s+[A-Z]/.test(trimmed) && trimmed.length > 40) return false;

      const normalizedParagraph = normalizeForMatch(trimmed);
      if (normalizedParagraph.length < 40) return true;

      return !normalizedCandidates.some(candidate => {
        const paragraphProbe = normalizedParagraph.slice(0, Math.min(140, normalizedParagraph.length));
        const candidateProbe = candidate.slice(0, Math.min(140, candidate.length));
        return candidate.includes(paragraphProbe) || normalizedParagraph.includes(candidateProbe);
      });
    })
    .join('\n\n');
};

const firstSubstantiveRawLine = (rawText = ''): string => {
  const lines = normalizeWhitespace(rawText)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const withoutPageNumber = line.replace(/^\d{1,5}\s+/, '').replace(/\s+\d{1,5}$/, '').trim();
    const letters = withoutPageNumber.replace(/[^A-Za-z]/g, '');
    const words = withoutPageNumber.split(/\s+/).filter(Boolean);
    const isStandalonePageNumber = /^\d{1,5}$/.test(line);
    const isRunningHeader =
      letters.length >= 8
      && withoutPageNumber === withoutPageNumber.toUpperCase()
      && words.length <= 8;

    if (!isStandalonePageNumber && !isRunningHeader) return withoutPageNumber || line;
  }

  return '';
};

const rawPageStartsWithSentenceContinuation = (
  page?: Pick<ExtractionPageInput, 'rawText' | 'pageNum' | 'realPageNum'>
): boolean => {
  if (!page || page.pageNum <= 1) return false;
  const firstLine = firstSubstantiveRawLine(page.rawText);
  return /^[('"[\s]*[a-z]/.test(firstLine);
};

const stripLeadingContinuationSentence = (
  text: string,
  page?: CleanExtractedPageOptions
): string => {
  if (page?.source === 'raw' || !rawPageStartsWithSentenceContinuation(page)) return text;

  const paragraphs = text.split(/\n{2,}/);
  const firstParagraph = paragraphs[0]?.trim();
  if (!firstParagraph || isLikelySectionHeading(firstParagraph)) return text;

  const sentenceMatch = /[.!?](?:["')\]]|\u201d|\u2019)?(?:\s|$)/.exec(firstParagraph);
  if (sentenceMatch && sentenceMatch.index < 420) {
    const cutIndex = sentenceMatch.index + sentenceMatch[0].length;
    const remainder = firstParagraph.slice(cutIndex).trim();
    if (remainder) {
      paragraphs[0] = remainder;
    } else {
      paragraphs.shift();
    }
    return paragraphs.join('\n\n').trim();
  }

  if (firstParagraph.length <= 360 && paragraphs.length > 1) {
    paragraphs.shift();
    return paragraphs.join('\n\n').trim();
  }

  return text;
};

export const cleanExtractedPageText = (
  input: string,
  page?: CleanExtractedPageOptions
): string => {
  let text = cleanNarrativeText(input);
  text = stripLikelyRunningHeaders(text, page?.realPageNum ?? page?.pageNum);
  text = stripFootnoteParagraphsFromRaw(text, page?.rawText);
  text = stripLeadingContinuationSentence(text, page);
  return cleanNarrativeText(text);
};

const firstNWordsEndIndex = (text: string, count: number): number => {
  const matcher = /\S+/g;
  let match: RegExpExecArray | null;
  let seen = 0;
  let end = 0;

  while ((match = matcher.exec(text)) !== null) {
    seen++;
    end = match.index + match[0].length;
    if (seen >= count) return end;
  }

  return end;
};

export const dedupePageStart = (previousText: string | undefined, currentText: string): string => {
  const previousWords = normalizeForMatch(previousText || '').split(' ').filter(Boolean);
  const currentWords = normalizeForMatch(currentText).split(' ').filter(Boolean);
  if (previousWords.length < 12 || currentWords.length < 12) return currentText;

  const maxOverlap = Math.min(80, previousWords.length, currentWords.length);
  for (let count = maxOverlap; count >= 12; count--) {
    const previousSuffix = previousWords.slice(-count).join(' ');
    const currentPrefix = currentWords.slice(0, count).join(' ');
    if (previousSuffix === currentPrefix) {
      return currentText.slice(firstNWordsEndIndex(currentText, count)).trimStart();
    }
  }

  return currentText;
};

const removeCitationNoiseForSpeech = (text: string): string =>
  text
    .replace(/\s+\((?=[^)]{0,180}\b(?:19|20)\d{2}[a-z]?\b)[^)]{0,180}\)/g, '')
    .replace(/\s+\[(?=(?:\d+\s*,\s*)*\d+\])(?:\d+\s*,\s*)*\d+\]/g, '')
    .replace(/[ \t]{2,}/g, ' ');

const replaceRepeatedly = (
  value: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
  limit = 8
): string => {
  let result = value;
  for (let i = 0; i < limit; i++) {
    const next = result.replace(pattern, replacement as any);
    if (next === result) return result;
    result = next;
  }
  return result;
};

const latexCommandNames: Record<string, string> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'epsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  vartheta: 'theta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  upsilon: 'upsilon',
  phi: 'phi',
  varphi: 'phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Gamma: 'capital gamma',
  Delta: 'capital delta',
  Theta: 'capital theta',
  Lambda: 'capital lambda',
  Xi: 'capital xi',
  Pi: 'capital pi',
  Sigma: 'capital sigma',
  Phi: 'capital phi',
  Psi: 'capital psi',
  Omega: 'capital omega',
  leq: 'less than or equal to',
  geq: 'greater than or equal to',
  neq: 'not equal to',
  approx: 'approximately',
  sim: 'similar to',
  propto: 'proportional to',
  times: 'times',
  cdot: 'times',
  infty: 'infinity',
  partial: 'partial',
  nabla: 'nabla',
  sum: 'sum',
  prod: 'product',
  int: 'integral',
  log: 'log',
  ln: 'natural log',
  exp: 'exponential',
  max: 'maximum',
  min: 'minimum',
  argmax: 'arg max',
  argmin: 'arg min',
  to: 'to',
  rightarrow: 'goes to',
  leftarrow: 'comes from',
  in: 'in',
  notin: 'not in',
};

const speakLatex = (latex: string): string => {
  let text = latex
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\quad|\\qquad/g, ' ')
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]+)\}/g, '$1');

  text = replaceRepeatedly(text, /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 over $2');
  text = replaceRepeatedly(text, /\\sqrt\s*\{([^{}]+)\}/g, 'square root of $1');
  text = replaceRepeatedly(text, /\\(?:hat|widehat)\s*\{([^{}]+)\}/g, '$1 hat');
  text = replaceRepeatedly(text, /\\(?:tilde|widetilde)\s*\{([^{}]+)\}/g, '$1 tilde');
  text = replaceRepeatedly(text, /\\bar\s*\{([^{}]+)\}/g, '$1 bar');

  text = text
    .replace(/([A-Za-z0-9)]+)_\{([^{}]+)\}/g, '$1 sub $2')
    .replace(/([A-Za-z0-9)]+)\^\\?\{([^{}]+)\}/g, '$1 to the power of $2')
    .replace(/([A-Za-z0-9)]+)_([A-Za-z0-9])/g, '$1 sub $2')
    .replace(/([A-Za-z0-9)]+)\^([A-Za-z0-9])/g, '$1 to the power of $2')
    .replace(/\\([A-Za-z]+)/g, (_match, command: string) => latexCommandNames[command] || command)
    .replace(/[{}]/g, ' ')
    .replace(/_/g, ' sub ')
    .replace(/\^/g, ' to the power of ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/\s-\s/g, ' minus ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/\//g, ' over ')
    .replace(/\*/g, ' times ')
    .replace(/\s+/g, ' ')
    .trim();

  return text || 'the displayed equation';
};

export const makeTextSpeakable = (input: string): string => {
  let text = cleanNarrativeText(input);
  text = removeCitationNoiseForSpeech(text);

  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]/g, (_match, label: string) => {
      if (/^(?:fig(?:ure)?\.?|table|equation|eq\.?)\b/i.test(label.trim())) {
        return `${label.trim()}.`;
      }
      return label;
    });

  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, math: string) => ` Equation: ${speakLatex(math)}. `)
    .replace(/\$([^$\n]+?)\$/g, (_match, math: string) => ` ${speakLatex(math)} `)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return text;
};

const splitLongSentence = (sentence: string, maxChars: number): string[] => {
  if (sentence.length <= maxChars) return [sentence];

  const chunks: string[] = [];
  let remaining = sentence.trim();

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const splitAt = Math.max(
      window.lastIndexOf('; '),
      window.lastIndexOf(', '),
      window.lastIndexOf(' ')
    );
    const safeSplit = splitAt > maxChars * 0.45 ? splitAt + 1 : maxChars;
    chunks.push(remaining.slice(0, safeSplit).trim());
    remaining = remaining.slice(safeSplit).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

export const splitTextForTts = (input: string, maxChars = DEFAULT_TTS_CHUNK_CHARS): string[] => {
  const text = makeTextSpeakable(input);
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = '';
  const paragraphs = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);

  const pushPart = (part: string) => {
    if (!part) return;
    if (!current) {
      current = part;
      return;
    }
    if (current.length + part.length + 2 <= maxChars) {
      current += `\n\n${part}`;
    } else {
      chunks.push(current);
      current = part;
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      pushPart(paragraph);
      continue;
    }

    const sentences = paragraph.match(/[^.!?\n]+[.!?\n]*(?:\s+|$)/g) || [paragraph];
    for (const sentence of sentences) {
      for (const part of splitLongSentence(sentence.trim(), maxChars)) {
        pushPart(part);
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
};
