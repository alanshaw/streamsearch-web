# streamsearch-web

A web stream that allows searching for a needle in the stream data using the Boyer-Moore-Horspool algorithm.

This module is forked from [streamsearch](https://github.com/mscdex/streamsearch), which is based heavily on the Streaming Boyer-Moore-Horspool C++ implementation by Hongli Lai [here](https://github.com/FooBarWidget/boyer-moore-horspool).

## Install

```sh
npm install streamsearch-web
```

## Usage

### Example

```js
import { StreamSearch } from 'streamsearch-web'

const needle = new TextEncoder().encode('\r\n')
const ss = new StreamSearch(needle)

const chunks = [
  'foo',
  ' bar',
  '\r',
  '\n',
  'baz, hello\r',
  '\n world.',
  '\r\n Browser rules!!\r\n\r\n',
]
const src = new ReadableStream({
  pull (controller) {
    const chunk = chunks.shift()
    if (!chunk) return controller.close()
    const buf = new TextEncoder().encode(chunk)
    controller.enqueue(buf)
  }
})

for await (const { isMatch, data, begin, end } of src.pipeThrough(ss)) {
  if (data)
    console.log('data: ' + new TextDecoder().decode(data.subarray(begin, end)))
  if (isMatch)
    console.log('match!')
}

// output:
//
// data: 'foo'
// data: ' bar'
// match!
// data: 'baz, hello'
// match!
// data: ' world.'
// match!
// data: ' Browser rules!!'
// match!
// data: ''
// match!
```

### Advanced

The transform stream allows for easy streaming usage, but due to the async nature of streams involves extra copy operations to ensure all data is safe to use further down the pipeline, even after the next chunk of data has been read and processed by the stream. To potentially avoid these additional copies, the underlying `SBMH` class can be used directly, which operates similarly to the original [`streamsearch` module](https://github.com/mscdex/streamsearch), except that it uses generator functions instead of a callback (and uses `Uint8Array`s instead of the Node.js `Buffer`).

```js
import { SBMH } from 'streamsearch-web'

const needle = new TextEncoder().encode('\r\n')
const sbmh = new SBMH(needle)

const chunks = [
  'foo',
  ' bar',
  '\r',
  '\n',
  'baz, hello\r',
  '\n world.',
  '\r\n Browser rules!!\r\n\r\n',
]

for (const chunk of chunks) {
  const buf = new TextEncoder().encode(chunk)
  for (const { isMatch, data, begin, end, isSafe } of sbmh.push(buf)) {
    // `isSafe` indicates if it is safe to store a reference to `data` (e.g.
    // as-is or via `data.slice()`) or not, as in some cases `data` may point
    // to a `Uint8Array` whose contents change over time.
    if (!isSafe)
      // Use `data.slice()` if storing reference for after this loop iteration.
    if (data)
      console.log('data: ' + new TextDecoder().decode(data.subarray(begin, end)))
    if (isMatch)
      console.log('match!')
  }
}
```

## API

### `class StreamSearch extends TransformStream<Uint8Array, MaybeMatch>`

`StreamSearch` is a [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) that searches for a needle within the data piped to the writable side. The readable side yields [`MaybeMatch`](#type-maybematch) objects, which is either a indication that a match was made _or_ a chunk of data that didn't match.

#### `constructor (needle: Uint8Array, options?: { maxMatches?: number })`

Creates and returns a new instance for searching for a `Uint8Array` `needle`.

The `maxMatches` option indicates the maximum number of matches that can be made. Defaults to `Infinity`.

#### `matches: number`

The current match count.

### `reset (): void`

Resets internal state. Useful for when you wish to start searching a new/different stream for example.

### `type MaybeMatch`

This object is yielded from the readable side of the stream any time there is non-matching data or there is a needle match.

1. `isMatch: boolean` - Indicates whether a match has been found.
2. `hasNonMatchData: boolean` - Indicates whether non matched data is also present.
3. `data?: Uint8Array` - If set, this contains data that did not match the needle.
4. `begin?: number` - The index in `data` where the non-matching data begins (inclusive).
5. `end?: number` - The index in `data` where the non-matching data ends (exclusive).

## Contributing

Feel free to join in. All welcome. [Open an issue](https://github.com/alanshaw/streamsearch-web/issues)!

## License

Licensed under [MIT](https://github.com/alanshaw/streamsearch-web/blob/master/LICENSE)
