import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Strips raw markdown syntax characters (*, **, #, `) for clean inline display in cards.
 */
export function cleanMarkdownText(text: string): string {
  if (!text) return '';
  return text
    // Replace bullet prefixes like "* ", "- ", "+ "
    .replace(/^[\s]*[*\-+]\s+/gm, '')
    // Replace numbered list prefixes like "1. "
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Replace markdown headers like "### "
    .replace(/^[\s]*#{1,6}\s+/gm, '')
    // Replace bold/italic markers like "**text**" or "*text*"
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Replace inline code backticks `code`
    .replace(/`([^`]+)`/g, '$1')
    // Normalize excess whitespace
    .trim();
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '', style }) => {
  if (!content) return null;

  return (
    <div
      className={`markdown-content ${className}`}
      style={{
        lineHeight: 1.7,
        fontSize: '0.9375rem',
        color: 'var(--text)',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0.85rem 0 0.5rem', color: 'var(--text)' }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0.75rem 0 0.45rem', color: 'var(--text)' }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0.65rem 0 0.4rem', color: 'var(--text)' }}>
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 0.65rem', lineHeight: 1.7 }}>
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0.35rem 0 0.75rem', paddingLeft: '1.25rem', listStyleType: 'disc' }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0.35rem 0 0.75rem', paddingLeft: '1.25rem', listStyleType: 'decimal' }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '0.25rem 0', lineHeight: 1.65 }}>
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 700, color: 'var(--text)' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic' }}>{children}</em>
          ),
          code: ({ children }) => (
            <code
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.85em',
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 5px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              }}
            >
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: '3px solid var(--accent, #3b82f6)',
                margin: '0.5rem 0',
                paddingLeft: '0.75rem',
                color: 'var(--text-soft)',
                fontStyle: 'italic',
              }}
            >
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent, #3b82f6)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          hr: () => (
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
