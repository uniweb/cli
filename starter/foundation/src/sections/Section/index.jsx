import { H1, H2, P, Link, cn } from '@uniweb/kit'

/**
 * Section Component
 *
 * A versatile content section that handles headings, text, and links.
 * Uses semantic tokens so it adapts to any theme context automatically.
 */
export default function Section({ content, params }) {
  const { title, pretitle, subtitle, paragraphs = [], links = [], imgs = [] } = content || {}

  const {
    align = 'center',
    width = 'default',
  } = params || {}

  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }

  const widths = {
    narrow: 'max-w-2xl',
    default: 'max-w-4xl',
    wide: 'max-w-6xl',
    full: 'max-w-none',
  }

  return (
    <div className={cn('py-16 px-6', alignments[align])}>
      <div className={cn('mx-auto', widths[width])}>
        {pretitle && (
          <p className="text-sm font-medium text-link mb-4 uppercase tracking-wide">
            {pretitle}
          </p>
        )}

        {title && (
          <H1
            text={title}
            className="text-heading text-3xl sm:text-4xl font-bold mb-4"
          />
        )}

        {subtitle && (
          <H2
            text={subtitle}
            className="text-body text-xl mb-6"
          />
        )}

        {paragraphs.map((para, index) => (
          <P
            key={index}
            text={para}
            className="text-body text-lg mb-4 leading-relaxed"
          />
        ))}

        {links.length > 0 && (
          <div className={cn('mt-8 flex gap-4 flex-wrap', align === 'center' && 'justify-center')}>
            {links.map((link, index) => (
              <Link
                key={index}
                to={link.href}
                className={cn(
                  'inline-flex items-center px-6 py-3 font-medium rounded-lg transition-colors',
                  index === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary-hover'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}

        {imgs.length > 0 && (
          <div className="mt-8">
            {imgs.map((img, index) => (
              <img
                key={index}
                src={img.url || img.src}
                alt={img.alt || ''}
                className="rounded-lg shadow-lg mx-auto"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
