import type { Plugin } from 'vite'

/**
 * Production build only: puts the app's CSS inside index.html (<style>) instead of a separate render-blocking file.
 *
 * Why: on a slow connection the browser downloads the CSS and the JavaScript at the same time and they share the
 * bandwidth, so the first paint waited for the CSS to squeeze through behind the script. With the CSS inside the HTML,
 * the first paint depends on ONE file. The app is a single-page app (the HTML loads once per visit), so losing a
 * separately cached CSS file costs almost nothing. Measured on simulated slow 3G; see docs/DECISIONS.md (008).
 */
export function inlineCss(): Plugin {
  return {
    name: 'touchgrass-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') return // the Worker build has no index.html
      let source = typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source)

      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !fileName.endsWith('.css')) continue
        const css = typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
        const link = new RegExp(`<link[^>]*rel="stylesheet"[^>]*href="[^"]*${fileName.split('/').pop()}"[^>]*>`)
        if (!link.test(source)) continue
        // "</style" inside CSS would end the tag early; escaping the slash keeps it valid.
        source = source.replace(link, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
        delete bundle[fileName]
      }
      html.source = source
    },
  }
}
