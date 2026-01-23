import React from 'react'
import { H2, H3, P, cn } from '@uniweb/kit'

/**
 * Features Component
 *
 * Display a list of features in a grid. Uses items (H3 sections)
 * from the markdown content.
 */
export function Features({ content, params }) {
  const { title, subtitle, items = [] } = content || {}

  const {
    columns = 3,
    theme = 'light',
  } = params || {}

  const themes = {
    light: 'bg-white text-gray-900',
    gray: 'bg-gray-50 text-gray-900',
    dark: 'bg-gray-900 text-white',
  }

  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  }

  return (
    <section className={cn('py-16 px-6', themes[theme])}>
      <div className="max-w-6xl mx-auto">
        {(title || subtitle) && (
          <div className="text-center mb-12">
            {title && (
              <H2 text={title} className="text-3xl font-bold mb-4" />
            )}
            {subtitle && (
              <p className={cn(
                'text-lg',
                theme === 'light' || theme === 'gray' ? 'text-gray-600' : 'text-gray-300'
              )}>
                {subtitle}
              </p>
            )}
          </div>
        )}

        <div className={cn('grid gap-8', gridCols[columns] || 'md:grid-cols-3')}>
          {items.map((item, index) => (
            <div key={index} className="text-center">
              {item.title && (
                <H3
                  text={item.title}
                  className="text-xl font-semibold mb-3"
                />
              )}
              {item.paragraphs?.[0] && (
                <P
                  text={item.paragraphs[0]}
                  className={cn(
                    theme === 'light' || theme === 'gray' ? 'text-gray-600' : 'text-gray-300'
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Features
