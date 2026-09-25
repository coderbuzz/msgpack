<!-- docs: sync from coderbuzz/codex@a2d275a -->

# Msgpack: `@coderbuzz/msgpack`

> **MessagePack for TypeScript that is safe on untrusted input.** Smaller than JSON, byte-compatible with `@msgpack/msgpack`, no dependencies, and no silent failures.
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/msgpack/blob/main/AI_KNOWLEDGE.md) for expert context.
<p align="center">
  <a href="https://www.npmjs.com/package/@coderbuzz/msgpack"><img src="https://img.shields.io/npm/v/@coderbuzz/msgpack.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@coderbuzz/msgpack"><img src="https://img.shields.io/npm/dm/@coderbuzz/msgpack.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/coderbuzz/msgpack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/coderbuzz/msgpack.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/coderbuzz/msgpack"><img src="https://img.shields.io/github/stars/coderbuzz/msgpack.svg?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/coderbuzz/msgpack/actions/workflows/ci.yml"><img src="https://github.com/coderbuzz/msgpack/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/coderbuzz/msgpack"><img src="https://codecov.io/gh/coderbuzz/msgpack/graph/badge.svg" alt="Codecov" /></a>
</p>

`@coderbuzz/msgpack` encodes and decodes [MessagePack](https://msgpack.org). Compact objects are **~35% smaller** than JSON, and small-integer arrays **~33% smaller**. It runs on Bun, Node.js and Deno.

---

## Why @coderbuzz/msgpack?

- **Safe to decode untrusted bytes.** Every read is bounds-checked. A length header can never make it allocate more than the input holds. Nesting is limited (512 by default), and so are string, bin, array, map and ext lengths if you ask. Malformed, truncated or trailing input throws `MsgpackDecodeError` with a `code` and an `offset`, never a half-decoded value.
- **No silent failures.** A function, a symbol, a `Set`, a bigint outside 64 bits or a circular reference throws `MsgpackEncodeError` with the path to the value (`$.items[0].onSave`), instead of writing something wrong.
- **`__proto__` stays data.** A `__proto__` key becomes an own property, like `JSON.parse`, so it cannot plant inherited fields on the decoded object.
- **Compatible.** For JSON-shaped data the bytes match `@msgpack/msgpack`. It reads `float32`, ext types and the spec's Timestamp from any encoder, and unknown ext types round-trip unchanged.
- **Fast paths.** A reusable encoder buffer, inline UTF-8 for short strings, in-place UTF-8 for long ones, and a key cache in the decoder.
- **Options when you need them.** Timestamps, sorted keys, 64-bit integers as `number`, `Map` output, zero-copy bin, strict UTF-8 and custom extensions, all through `new Encoder()` / `new Decoder()`.

---

## Benchmarks

Numbers from **[github.com/coderbuzz/benchmarks](https://github.com/coderbuzz/benchmarks)** (`results/latest.json`, 2026-06-21, Apple Silicon, Bun 1.3.14). They were measured on **0.1.7**, before this release's decoder rewrite, so they are not current.

| Scenario | @coderbuzz/msgpack | @msgpack/msgpack | JSON |
|---|---|---|---|
| Nested object encode | **2.04M ops/s** | 0.77M | 4.78M |
| Nested object decode | **0.90M ops/s** | 0.87M | 1.96M |
| Wire size (nested object) | **133 bytes** | 133 bytes | 178 bytes |

JSON.stringify/parse are native and faster on this payload, but produce larger output and have no binary type. See [AI_KNOWLEDGE.md](https://github.com/coderbuzz/msgpack/blob/main/AI_KNOWLEDGE.md) for local measurements of this release against msgpackr, `@msgpack/msgpack` and notepack.io.

### Size compared to JSON

| Payload type | JSON size | Msgpack size | Savings |
|---|---|---|---|
| Compact object `{ name, age, active }` | 39 bytes | 25 bytes | **~36%** |
| Numeric array `[1..1000]` | 3894 bytes | 2621 bytes | **~33%** |
| Nested object (benchmark payload) | 178 bytes | 133 bytes | **~25%** |

---

## Installation

```sh
# npm
npm install @coderbuzz/msgpack

# Bun
bun add @coderbuzz/msgpack

# Deno
import { encode, decode } from "npm:@coderbuzz/msgpack";
```

---

## Quick Start

```ts
import { decode, encode } from "@coderbuzz/msgpack";

const bytes = encode({ name: "Alice", age: 30, active: true });
// => Uint8Array, 25 bytes (JSON: 39)

const value = decode(bytes);
// => { name: "Alice", age: 30, active: true }
```

Decoding a request body:

```ts
import { decode, MsgpackDecodeError } from "@coderbuzz/msgpack";

try {
  const body = decode(new Uint8Array(await req.arrayBuffer()));
} catch (err) {
  if (err instanceof MsgpackDecodeError) return new Response("bad msgpack", { status: 400 });
  throw err;
}
```

---

## API Reference

### `encode(value): Uint8Array`

Returns a new `Uint8Array` that you own.

| Value | Encoding |
|---|---|
| `null` / `undefined` | nil |
| `boolean` | true / false |
| `number` (integer) | smallest of fixint, uint8/16/32, int8/16/32; beyond 32 bits float64 (or int64, see options) |
| `number` (other) | float64 |
| `bigint` | uint64 / int64; outside that range throws |
| `string` | fixstr, str8/16/32 (unpaired surrogates become U+FFFD, as `TextEncoder` does) |
| `Uint8Array`, other typed arrays, `DataView`, `ArrayBuffer` | bin (raw bytes) |
| `Date` | ISO string (or Timestamp ext, see options) |
| `Array` | array |
| plain object, `Map` | map |
| `MsgpackExt` | ext, as-is |
| object with `toJSON()` | its `toJSON()` result |
| function, symbol, `Set`, class instance without `toJSON()` | throws `MsgpackEncodeError` |

### `decode(data: Uint8Array): unknown`

Decodes exactly one value. Throws `MsgpackDecodeError` for malformed, truncated, over-deep or trailing input. Maps become plain objects (string and number keys). `uint64`/`int64` become `bigint`. Timestamp becomes `Date`. Other ext types become `MsgpackExt`.

### `decodeMulti(data): unknown[]` and `decodeAt(data, offset?): { value, end }`

For buffers holding several concatenated messages. `decodeAt` returns the offset just past the value. A `TRUNCATED` error means the last value is incomplete, so a stream reader can wait for more bytes.

### `encodeUnsafe(value): Uint8Array`

Returns a **view** into the encoder's buffer, overwritten by the next `encode*` call. Use it only with APIs that copy synchronously:

```ts
// Good: these copy the bytes when called
new Response(encodeUnsafe(data));
new Blob([encodeUnsafe(data)]);
bunServerWebSocket.send(encodeUnsafe(data)); // Bun's ServerWebSocket

// Bad: Node's socket.write() and stream write() keep a reference; later encodes overwrite queued frames
socket.write(encodeUnsafe(data)); // use encode(data)
```

Never use `.buffer` of the result: it is the whole internal buffer, including bytes from earlier encodes.

### `encodeInto(value, target, offset?): number`

Writes into your buffer and returns the byte count. Throws `RangeError` if it does not fit.

### `encodedSize(value): number`

The exact length `encode(value)` would return. It encodes into a private buffer, so it costs about one encode.

### `new Encoder(options)` / `new Decoder(options)`

Each instance has its own options and its own buffer. Methods are bound.

```ts
import { Decoder, Encoder } from "@coderbuzz/msgpack";

const enc = new Encoder({ date: "timestamp", sortKeys: true });
const dec = new Decoder({ int64: "auto", maxStrLength: 1 << 20 });

dec.decode(enc.encode({ at: new Date(), id: 1 }));
```

| Encoder option | Default | Effect |
|---|---|---|
| `unsupported` | `'throw'` | `'ignore'` omits unsupported values (nil in arrays) |
| `ignoreUndefined` | `false` | omit keys whose value is `undefined` |
| `sortKeys` | `false` | sorted keys, for deterministic bytes |
| `date` | `'string'` | `'timestamp'` writes the Timestamp ext |
| `largeInt` | `'float64'` | `'int64'` writes uint64/int64 for safe integers beyond 32 bits |
| `maxDepth` | `512` | nesting limit (a circular reference fails here) |
| `extensions` | `[]` | custom ext types |

| Decoder option | Default | Effect |
|---|---|---|
| `int64` | `'bigint'` | `'auto'`: number when safe; `'number'`: error when unsafe |
| `mapAs` | `'object'` | `'map'` returns `Map` with any key type |
| `copyBinary` | `true` | `false` returns bin as views into the input |
| `strictUtf8` | `false` | invalid UTF-8 is an error instead of U+FFFD |
| `maxDepth` | `512` | nesting limit |
| `maxStrLength`, `maxBinLength`, `maxArrayLength`, `maxMapLength`, `maxExtLength` | unlimited | per-value limits |
| `extensions` | `[]` | custom ext types |

### Extensions

```ts
import { Decoder, Encoder, type Extension } from "@coderbuzz/msgpack";

class Money { constructor(readonly minor: bigint, readonly currency: string) {} }

const money: Extension = {
  type: 1, // 0..127
  match: (v) => v instanceof Money,
  encode: (m: Money) => new Encoder().encode([m.minor, m.currency]),
  decode: (data) => { const [minor, currency] = new Decoder().decode(data) as [bigint, string]; return new Money(minor, currency); },
};

const enc = new Encoder({ extensions: [money] });
const dec = new Decoder({ extensions: [money] });
```

---

## Edge Cases

| Input | Behavior |
|---|---|
| `undefined` | nil; decodes as `null` (omit it with `ignoreUndefined`) |
| `-0`, `NaN`, `±Infinity` | preserved (float64) |
| Unpaired surrogate | U+FFFD, the same bytes as `TextEncoder` |
| Leading U+FEFF | kept, not treated as a byte-order mark |
| Circular reference | `MsgpackEncodeError` `MAX_DEPTH` |
| Re-entrant `encode()` (from a getter or `toJSON`) | works; gets its own buffer |
| Key `__proto__` | an own property, like `JSON.parse` |
| Integer > 2^32 | float64 (same 9 bytes); `largeInt: 'int64'` for uint64/int64 |

---

## Limitations

- **No streaming decoder** for byte streams: use `decodeAt` on a buffer that grows.
- **Bin data is copied** by default (`copyBinary: false` for views).
- **No CJS build**: ESM only. Node.js 18+ with `"type": "module"`.
- **Bundle size**: about 8 KB gzip unminified (6 KB minified).

---

## License

MIT &copy; 2026 Indra Gunawan
