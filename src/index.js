/**
 * @typedef {{
 *   data: Uint8Array
 *   begin: number
 *   end: number
 * }} NonMatchedData
 * @typedef {{ isSafe: boolean }} MaybeSafe
 * @typedef {{ isMatch: true, hasNonMatchData: false }} ExactMatch
 * @typedef {{ isMatch: true, hasNonMatchData: true } & NonMatchedData} Match
 * @typedef {{
 *   isMatch: false
 *   hasNonMatchData: true
 * } & NonMatchedData} NonMatch
 * @typedef {Match|ExactMatch|NonMatch} MaybeMatch
 */
 
/**
 * @typedef {{
 *   matches: number
 *   maxMatches: number
 *   lookbehindSize: number
 *   needle: Uint8Array
 *   bufPos: number
 *   lookbehind: Uint8Array
 *   occ: number[]
 * }} State
 */

/**
 * @param {Uint8Array} buf1 
 * @param {number} pos1
 * @param {Uint8Array} buf2 
 * @param {number} pos2
 * @param {number} num
 */
const memcmp = (buf1, pos1, buf2, pos2, num) => {
  for (let i = 0; i < num; ++i) {
    if (buf1[pos1 + i] !== buf2[pos2 + i])
      return false
  }
  return true
}

export class SBMH {
  /** @type {State} */
  #state

  /**
   * @param {Uint8Array} needle
   * @param {object} [options]
   * @param {number} [options.maxMatches]
   */
  constructor (needle, options) {
    const needleLen = needle.length
    const occ = Array(256).fill(needleLen)

    // Populate occurrence table with analysis of the needle, ignoring the last
    // letter.
    if (needleLen > 1) {
      for (let i = 0; i < needleLen - 1; ++i)
        occ[needle[i]] = needleLen - 1 - i
    }

    /** @type {State} */
    this.#state = {
      matches: 0,
      maxMatches: options?.maxMatches ?? Infinity,
      lookbehindSize: 0,
      needle,
      bufPos: 0,
      lookbehind: new Uint8Array(needleLen),
      occ
    }
  }

  get matches () {
    return this.#state.matches
  }

  /** @param {Uint8Array} chunk */
  * push (chunk) {
    let result
    this.#state.bufPos = 0
    while (result !== chunk.length && this.#state.matches < this.#state.maxMatches)
      result = yield * feed(this.#state, chunk)
  }

  reset () {
    this.#state.matches = 0
    this.#state.lookbehindSize = 0
    this.#state.bufPos = 0
  }

  /** @returns {(Match & MaybeSafe)|ExactMatch|(NonMatch & MaybeSafe)|undefined} */
  destroy () {
    try {
      const lbSize = this.#state.lookbehindSize
      if (lbSize) {
        return {
          isMatch: false,
          hasNonMatchData: true,
          data: this.#state.lookbehind,
          begin: 0,
          end: lbSize,
          isSafe: false
        }
      }
    } finally {
      this.reset()
    }
  }
}

/**
 * @param {State} state
 * @param {Uint8Array} data
 * @returns {Generator<(Match & MaybeSafe)|ExactMatch|(NonMatch & MaybeSafe), number>}
 */
const feed = function * (state, data) {
  const len = data.length
  const needle = state.needle
  const needleLen = needle.length

  // Positive: points to a position in `data`
  //           pos == 3 points to data[3]
  // Negative: points to a position in the lookbehind buffer
  //           pos == -2 points to lookbehind[lookbehindSize - 2]
  let pos = -state.lookbehindSize
  const lastNeedleCharPos = needleLen - 1
  const lastNeedleChar = needle[lastNeedleCharPos]
  const end = len - needleLen
  const occ = state.occ
  const lookbehind = state.lookbehind

  if (pos < 0) {
    // Lookbehind buffer is not empty. Perform Boyer-Moore-Horspool
    // search with character lookup code that considers both the
    // lookbehind buffer and the current round's haystack data.
    //
    // Loop until
    //   there is a match.
    // or until
    //   we've moved past the position that requires the
    //   lookbehind buffer. In this case we switch to the
    //   optimized loop.
    // or until
    //   the character to look at lies outside the haystack.
    while (pos < 0 && pos <= end) {
      const nextPos = pos + lastNeedleCharPos
      const ch = (nextPos < 0
                  ? lookbehind[state.lookbehindSize + nextPos]
                  : data[nextPos])

      if (ch === lastNeedleChar
          && matchNeedle(state, data, pos, lastNeedleCharPos)) {
        state.lookbehindSize = 0
        ++state.matches
        if (pos > -state.lookbehindSize) {
          yield {
            isMatch: true,
            hasNonMatchData: true,
            data: lookbehind,
            begin: 0,
            end: state.lookbehindSize + pos,
            isSafe: false
          }
        } else {
          yield { isMatch: true, hasNonMatchData: false }
        }

        return (state.bufPos = pos + needleLen)
      }

      pos += occ[ch]
    }

    // No match.

    // There's too few data for Boyer-Moore-Horspool to run,
    // so let's use a different algorithm to skip as much as
    // we can.
    // Forward pos until
    //   the trailing part of lookbehind + data
    //   looks like the beginning of the needle
    // or until
    //   pos == 0
    while (pos < 0 && !matchNeedle(state, data, pos, len - pos))
      ++pos

    if (pos < 0) {
      // Cut off part of the lookbehind buffer that has
      // been processed and append the entire haystack
      // into it.
      const bytesToCutOff = state.lookbehindSize + pos

      if (bytesToCutOff > 0) {
        // The cut off data is guaranteed not to contain the needle.
        yield {
          isMatch: false,
          hasNonMatchData: true,
          data: lookbehind,
          begin: 0,
          end: bytesToCutOff,
          isSafe: false
        }
      }

      state.lookbehindSize -= bytesToCutOff
      lookbehind.set(lookbehind.subarray(bytesToCutOff, state.lookbehindSize))
      lookbehind.set(data, state.lookbehindSize)
      state.lookbehindSize += len

      state.bufPos = len
      return len
    }

    // Discard lookbehind buffer.
    yield {
      isMatch: false,
      hasNonMatchData: true,
      data: lookbehind,
      begin: 0,
      end: state.lookbehindSize,
      isSafe: false
    }
    state.lookbehindSize = 0
  }

  pos += state.bufPos

  const firstNeedleChar = needle[0]

  // Lookbehind buffer is now empty. Perform Boyer-Moore-Horspool
  // search with optimized character lookup code that only considers
  // the current round's haystack data.
  while (pos <= end) {
    const ch = data[pos + lastNeedleCharPos]

    if (ch === lastNeedleChar
        && data[pos] === firstNeedleChar
        && memcmp(needle, 0, data, pos, lastNeedleCharPos)) {
      ++state.matches
      if (pos > 0) {
        yield {
          isMatch: true,
          hasNonMatchData: true,
          data,
          begin: state.bufPos,
          end: pos,
          isSafe: true
        }
      } else {
        yield { isMatch: true, hasNonMatchData: false }
      }

      return (state.bufPos = pos + needleLen)
    }

    pos += occ[ch]
  }

  // There was no match. If there's trailing haystack data that we cannot
  // match yet using the Boyer-Moore-Horspool algorithm (because the trailing
  // data is less than the needle size) then match using a modified
  // algorithm that starts matching from the beginning instead of the end.
  // Whatever trailing data is left after running this algorithm is added to
  // the lookbehind buffer.
  while (pos < len) {
    if (data[pos] !== firstNeedleChar
        || !memcmp(data, pos, needle, 0, len - pos)) {
      ++pos
      continue
    }
    lookbehind.set(data.subarray(pos, len))
    state.lookbehindSize = len - pos
    break
  }

  // Everything until `pos` is guaranteed not to contain needle data.
  if (pos > 0) {
    yield {
      isMatch: false,
      hasNonMatchData: true,
      data,
      begin: state.bufPos,
      end: pos < len ? pos : len,
      isSafe: true
    }
  }

  state.bufPos = len
  return len
}

/**
 * @param {State} state
 * @param {Uint8Array} data
 * @param {number} pos
 * @param {number} len
 */
const matchNeedle = (state, data, pos, len) => {
  const lb = state.lookbehind
  const lbSize = state.lookbehindSize
  const needle = state.needle

  for (let i = 0; i < len; ++i, ++pos) {
    const ch = (pos < 0 ? lb[lbSize + pos] : data[pos])
    if (ch !== needle[i])
      return false
  }
  return true
}

/** @extends {TransformStream<Uint8Array, MaybeMatch>} */
export class StreamSearch extends TransformStream {
  /**
   * @param {Uint8Array} needle
   * @param {object} [options]
   * @param {number} [options.maxMatches]
   * @param {QueuingStrategy<Uint8Array>} [options.writableStrategy]
   * @param {QueuingStrategy<MaybeMatch>} [options.readableStrategy]
   */
  constructor (needle, options) {
    const sbmh = new SBMH(needle, options)
    super({
      transform (chunk, controller) {
        for (const match of sbmh.push(chunk)) {
          // make data safe incase this chunk is queued
          if (match.hasNonMatchData && match.isSafe === false) {
            match.data = match.data.slice()
          }
          controller.enqueue(match)
        }
      },
      flush (controller) {
        const match = sbmh.destroy()
        if (match) controller.enqueue(match)
      }
    })
  }
}
