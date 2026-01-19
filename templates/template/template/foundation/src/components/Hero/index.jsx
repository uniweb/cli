import React from 'react'
import { H1, P, Link, cn } from '@uniweb/kit'

/**
 * Hero Component
 *
 * A hero section for landing pages. Customize this component
 * for your template's needs.
 */
export function Hero({ content, params }) {
  const { title, pretitle, subtitle } = content.main?.header || {}
  const { paragraphs = [], links = [], imgs = [] } = content.main?.body || {}

  const {
    theme = 'light',
    layout = 'center',
  } = params || {}

  const themes = {
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-900 text-white',
    gradient: 'bg-gradient-to-br from-primary to-primary-dark text-white',
  }

  const description = paragraphs[0]
  const cta = links[0]
  const secondaryCta = links[1]

  return (
    <section className={cn('py-20 px-6', themes[theme])}>
      <div className={cn('max-w-4xl mx-auto', layout === 'center' && 'text-center')}>
        {pretitle && (
          <span className="inline-block px-4 py-1 text-sm font-medium rounded-full bg-primary/10 text-primary mb-4">
            {pretitle}
          </span>
        )}

        {title && (
          <H1
            text={title}
            className="text-4xl sm:text-5xl font-bold mb-6 tracking-tight"
          />
        )}

        {subtitle && (
          <p className={cn(
            'text-xl mb-4',
            theme === 'light' ? 'text-gray-600' : 'text-gray-300'
          )}>
            {subtitle}
          </p>
        )}

        {description && (
          <P
            text={description}
            className={cn(
              'text-lg mb-8',
              theme === 'light' ? 'text-gray-600' : 'text-gray-300'
            )}
          />
        )}

        {(cta || secondaryCta) && (
          <div className={cn('flex gap-4 flex-wrap', layout === 'center' && 'justify-center')}>
            {cta && (
              <Link
                href={cta.href}
                className="px-6 py-3 font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors"
              >
                {cta.label}
              </Link>
            )}
            {secondaryCta && (
              <Link
                href={secondaryCta.href}
                className="px-6 py-3 font-semibold rounded-lg border-2 border-current hover:bg-gray-100 transition-colors"
              >
                {secondaryCta.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default Hero
