/**
 * `site.yml::preview` — the site's card image — has two writers: an author, who
 * writes an address (a URL, or a path to an image in the project), and the app,
 * which writes a token naming an image it generated. This is the one test that
 * tells them apart.
 */

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is an author's address rather than the app's token
 */
export const isAuthoredPreview = (value) =>
  typeof value === 'string' && (/^https?:\/\//i.test(value) || /^\.{0,2}\//.test(value))
