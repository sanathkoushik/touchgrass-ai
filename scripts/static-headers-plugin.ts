import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

/** Content of every inline <script> and <style> block (not external ones, not JSON data blocks). */
export function inlineBlocks(html: string): { scripts: string[]; styles: string[] } {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!)
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!)
  return { scripts: scripts.filter((s) => s.trim() !== ''), styles: styles.filter((s) => s.trim() !== '') }
}

/**
 * The strict Content-Security-Policy for the built page. The browser code only talks to its own origin (weather and
 * places are fetched by our Worker), so nothing else is allowed. The two inline blocks the build creates (the
 * first-paint shell script and the inlined stylesheet) are allowed by their exact hash, not by a blanket 'unsafe-inline'.
 */
export function contentSecurityPolicy(html: string): string {
  const { scripts, styles } = inlineBlocks(html)
  return [
    "default-src 'self'",
    `script-src 'self' ${scripts.map(sha256).join(' ')}`.trim(),
    `style-src 'self' ${styles.map(sha256).join(' ')}`.trim(),
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Cloudflare static-asset `_headers` file. Applies to files, not to /api responses (the Worker sets those). */
export function buildHeadersFile(html: string): string {
  return `# Generated at build time by scripts/static-headers-plugin.ts. Do not edit by hand.

# Hashed build files never change under the same name: cache for a year.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# Photos and icons: a month, then revalidate.
/photos/*
  Cache-Control: public, max-age=2592000
/favicon.svg
  Cache-Control: public, max-age=86400
/icons.svg
  Cache-Control: public, max-age=86400

# Every page and file.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(self)
  Content-Security-Policy: ${contentSecurityPolicy(html)}
`
}

/** Production build only. Must run AFTER inlineCss(), so the hashes cover the final HTML. */
export function staticHeaders(): Plugin {
  return {
    name: 'touchgrass-static-headers',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') return
      const source = typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source)
      this.emitFile({ type: 'asset', fileName: '_headers', source: buildHeadersFile(source) })
    },
  }
}
