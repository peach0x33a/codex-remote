/** Static remote HTML in an opaque, script-free iframe; relative files belong to the remote host. */
export function htmlPreviewDocument(source: string): string {
  const template = document.createElement('template')
  template.innerHTML = source
  for (const image of template.content.querySelectorAll('img, image, input[type="image"]')) {
    image.removeAttribute('srcset')
    for (const attribute of ['src', 'href', 'xlink:href']) {
      const value = image.getAttribute(attribute)
      if (value && !/^(?:https?:\/\/|data:image\/|#)/i.test(value.trim())) image.removeAttribute(attribute)
    }
  }
  for (const node of template.content.querySelectorAll('base, meta[http-equiv="refresh" i]')) node.remove()
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https: http:; font-src data:; base-uri \'none\'; form-action \'none\'">' + template.innerHTML
}
