/**
 * Foundation Entry Point
 *
 * Export all your template's components here.
 */

import Hero from './components/Hero/index.jsx'
import Features from './components/Features/index.jsx'

const components = {
  Hero,
  Features,
}

export function getComponent(name) {
  return components[name]
}

export function listComponents() {
  return Object.keys(components)
}

export function getSchema(name) {
  return components[name]?.schema
}

export function getAllSchemas() {
  const schemas = {}
  for (const [name, component] of Object.entries(components)) {
    if (component.schema) schemas[name] = component.schema
  }
  return schemas
}

export { Hero, Features }
export default { getComponent, listComponents, getSchema, getAllSchemas, components }
