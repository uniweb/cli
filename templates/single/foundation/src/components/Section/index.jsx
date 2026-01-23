import React from 'react'
import { H1, H2, P, Link, cn } from '@uniweb/kit'

/**
 * Section Component
 *
 * A versatile content section that handles headings, text, and links.
 * This is the default component for rendering markdown content.
 */
export function Section({ content, params }) {
  // Content fields: title, pretitle, subtitle, paragraphs, links, imgs, items
  const { title, pretitle, subtitle, paragraphs = [], links = [], imgs = [] } = content || {}

  const {
    theme = 'light',
    align = 'center',
    width = 'default',
  } = params || {}

  // Theme styles
  const themes = {
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-900 text-white',
    primary: 'bg-primary text-white',
  }

  // Alignment styles
  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }

  // Width styles
  const widths = {
    narrow: 'max-w-2xl',
    default: 'max-w-4xl',
    wide: 'max-w-6xl',
    full: 'max-w-none',
  }

  return (
    <section className={cn('py-16 px-6', themes[theme])}>
      <div className={cn('mx-auto', widths[width], alignments[align])}>
        {/* Pretitle / Eyebrow */}
        {pretitle && (
          <p className="text-sm font-medium text-primary mb-4 uppercase tracking-wide">
            {pretitle}
          </p>
        )}

        {/* Title */}
        {title && (
          <H1
            text={title}
            className="text-3xl sm:text-4xl font-bold mb-4"
          />
        )}

        {/* Subtitle */}
        {subtitle && (
          <H2
            text={subtitle}
            className={cn(
              'text-xl mb-6',
              theme === 'light' ? 'text-gray-600' : 'text-gray-300'
            )}
          />
        )}

        {/* Paragraphs */}
        {paragraphs.map((para, index) => (
          <P
            key={index}
            text={para}
            className={cn(
              'text-lg mb-4 leading-relaxed',
              theme === 'light' ? 'text-gray-700' : 'text-gray-300'
            )}
          />
        ))}

        {/* Links */}
        {links.length > 0 && (
          <div className={cn('mt-8 flex gap-4 flex-wrap', alignments[align] === 'text-center' && 'justify-center')}>
            {links.map((link, index) => (
              <Link
                key={index}
                href={link.href}
                className={cn(
                  'inline-flex items-center px-6 py-3 font-medium rounded-lg transition-colors',
                  index === 0
                    ? 'bg-primary text-white hover:bg-primary-dark'
                    : 'border border-current hover:bg-gray-100'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}

        {/* Images */}
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
    </section>
  )
}

export default Section
