/** Markdown sin HTML crudo (react-markdown lo ignora). Se carga en forma diferida. */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ texto }: { texto: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener nofollow" />,
          // Las imágenes externas filtrarían datos del lector: se muestran como enlace.
          img: ({ src, alt }) => (
            <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer noopener nofollow">
              {alt || 'Imagen'}
            </a>
          ),
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
