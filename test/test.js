import assert from 'node:assert'
import { StreamSearch } from '../src/index.js'

/**
 * @template T
 * @param {ReadableStream<T>} src
 * @returns {AsyncIterable<T>}
 */
// @ts-expect-error
const toAsyncIterable = src => src

;[
  {
    needle: '\r\n',
    chunks: [
      'foo',
      ' bar',
      '\r',
      '\n',
      'baz, hello\r',
      '\n world.',
      '\r\n Browser rules!!\r\n\r\n',
    ],
    expect: [
      [false, 'foo'],
      [false, ' bar'],
      [ true, null],
      [false, 'baz, hello'],
      [ true, null],
      [false, ' world.'],
      [ true, null],
      [ true, ' Browser rules!!'],
      [ true, ''],
    ],
  },
  {
    needle: '---foobarbaz',
    chunks: [
      '---foobarbaz',
      'asdf',
      '\r\n',
      '---foobarba',
      '---foobar',
      'ba',
      '\r\n---foobarbaz--\r\n',
    ],
    expect: [
      [ true, null],
      [false, 'asdf'],
      [false, '\r\n'],
      [false, '---foobarba'],
      [false, '---foobarba'],
      [ true, '\r\n'],
      [false, '--\r\n'],
    ],
  },
].forEach(async ({ needle, chunks, expect }, i) => {
  console.log(`Running test #${i + 1}`)

  const results = []
  const ss = new StreamSearch(new TextEncoder().encode(needle))

  const src = new ReadableStream({
    pull (controller) {
      const chunk = chunks.shift()
      if (!chunk) return controller.close()
      controller.enqueue(new TextEncoder().encode(chunk))
    }
  })

  for await (const match of toAsyncIterable(src.pipeThrough(ss))) {
    results.push([
      match.isMatch,
      match.hasNonMatchData
        ? new TextDecoder().decode(match.data.subarray(match.begin, match.end))
        : null
    ])
  }

  assert.deepStrictEqual(results, expect)
})
