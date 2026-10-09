import { describe, expect, it } from 'vitest'
import { inlineCss } from '../../scripts/inline-css-plugin'

type Bundle = Record<string, { type: 'asset' | 'chunk'; source?: string | Uint8Array; fileName?: string }>

function run(bundle: Bundle) {
  const plugin = inlineCss()
  const hook = plugin.generateBundle as unknown as (this: unknown, options: unknown, bundle: Bundle) => void
  hook.call({}, {}, bundle)
  return bundle
}

const HTML = '<!doctype html><head><link rel="stylesheet" crossorigin href="/assets/index-abc123.css"></head><body></body>'

describe('inlineCss build plugin', () => {
  it('moves the stylesheet into the HTML and removes the separate file', () => {
    const b = run({
      'index.html': { type: 'asset', source: HTML },
      'assets/index-abc123.css': { type: 'asset', source: 'body{color:red}' },
    })
    expect(b['index.html']!.source).toContain('<style>body{color:red}</style>')
    expect(b['index.html']!.source).not.toContain('<link rel="stylesheet"')
    expect(b['assets/index-abc123.css']).toBeUndefined()
  })

  it('handles binary (Uint8Array) sources too', () => {
    const enc = new TextEncoder()
    const b = run({
      'index.html': { type: 'asset', source: enc.encode(HTML) },
      'assets/index-abc123.css': { type: 'asset', source: enc.encode('a{b:c}') },
    })
    expect(b['index.html']!.source).toContain('<style>a{b:c}</style>')
  })

  it('cannot be broken out of by CSS that contains a closing style tag', () => {
    const b = run({
      'index.html': { type: 'asset', source: HTML },
      'assets/index-abc123.css': { type: 'asset', source: 'a::after{content:"</style><script>alert(1)</script>"}' },
    })
    const html = String(b['index.html']!.source)
    expect(html.match(/<\/style>/g)).toHaveLength(1)
    expect(html).not.toContain('</style><script>')
  })

  it('leaves a stylesheet alone if the HTML does not reference it', () => {
    const b = run({
      'index.html': { type: 'asset', source: '<html><body>no css here</body></html>' },
      'assets/other.css': { type: 'asset', source: 'x{}' },
    })
    expect(b['assets/other.css']).toBeDefined()
    expect(b['index.html']!.source).not.toContain('<style>')
  })

  it('does nothing in the Worker build (no index.html)', () => {
    const b = run({ 'index.js': { type: 'chunk' }, 'assets/x.css': { type: 'asset', source: 'x{}' } })
    expect(b['assets/x.css']).toBeDefined()
  })

  it('does not break when CSS text contains replacement patterns like $& or $1', () => {
    const b = run({
      'index.html': { type: 'asset', source: HTML },
      'assets/index-abc123.css': { type: 'asset', source: 'a::after{content:"$&$1$$"}' },
    })
    expect(b['index.html']!.source).toContain('content:"$&$1$$"')
  })
})
