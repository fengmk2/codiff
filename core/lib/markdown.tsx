import type { ReactNode } from 'react';

const renderText = (value: string, keyPrefix: string): Array<ReactNode> => {
  const textNodes: Array<ReactNode> = [];
  const emphasisPattern =
    /\*\*([^*\n]+)\*\*|(?<![\w_])_([^_\n]+)_(?![\w_])|(?<![\w*])\*([^*\n]+)\*(?![\w*])/g;
  let textLastIndex = 0;
  let emphasisMatch: RegExpExecArray | null;

  while ((emphasisMatch = emphasisPattern.exec(value))) {
    if (emphasisMatch.index > textLastIndex) {
      textNodes.push(value.slice(textLastIndex, emphasisMatch.index));
    }

    if (emphasisMatch[1] != null) {
      textNodes.push(
        <strong key={`${keyPrefix}:bold:${emphasisMatch.index}`}>{emphasisMatch[1]}</strong>,
      );
    } else {
      textNodes.push(
        <em key={`${keyPrefix}:italic:${emphasisMatch.index}`}>
          {emphasisMatch[2] ?? emphasisMatch[3]}
        </em>,
      );
    }
    textLastIndex = emphasisPattern.lastIndex;
  }

  if (textLastIndex < value.length) {
    textNodes.push(value.slice(textLastIndex));
  }

  return textNodes.length > 0 ? textNodes : [value];
};

export const renderInlineMarkdown = (text: string): ReactNode => {
  const nodes: Array<ReactNode> = [];
  const pattern = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(...renderText(text.slice(lastIndex, match.index), `${lastIndex}`));
    }

    nodes.push(
      <code className="walkthrough-inline-code" key={`${match.index}:${match[1]}`}>
        {match[1]}
      </code>,
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderText(text.slice(lastIndex), `${lastIndex}`));
  }

  return nodes.length > 0 ? nodes : text;
};
