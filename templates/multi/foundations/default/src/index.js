/**
 * Default Foundation Entry Point
 */

import Section from './components/Section/index.jsx'

const components = {
  Section,
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

export { Section }
export default { getComponent, listComponents, getSchema, getAllSchemas, components }
