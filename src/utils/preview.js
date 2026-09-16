/**
 * `site.yml::preview` — the site's card image — has two writers: an author, who
 * writes an address (a URL, or a path to an image in the project), and the app,
 * which writes a token naming an image it generated. This is the one test that
 * tells them apart.
 *
 * It recognizes the author's shapes rather than the app's, so it does not depend
 * on the token's format: a URL, a path starting `/`, `./` or `../`, or a relative
 * path to an image file (`images/card.png`).
 */

const IMAGE_FILE = /\.(avif|gif|jpe?g|png|svg|webp)$/i

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is an author's address rather than the app's token
 */
export const isAuthoredPreview = (value) =>
  typeof value === 'string' &&
  (/^https?:\/\//i.test(value) || /^\.{0,2}\//.test(value) || IMAGE_FILE.test(value.trim()))
