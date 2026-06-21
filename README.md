<!-- docs: sync from coderbuzz/codex@e9b6bce -->

# Msgpack &mdash; `@coderbuzz/msgpack`

> **High-performance MessagePack for TypeScript.** Smaller than JSON. 2x faster than `@msgpack/msgpack`. Zero unnecessary allocations.
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/msgpack/blob/main/AI_KNOWLEDGE.md) for expert context.
<p align="center">
  <a href="https://www.npmjs.com/package/@coderbuzz/msgpack"><img src="https://img.shields.io/npm/v/@coderbuzz/msgpack.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@coderbuzz/msgpack"><img src="https://img.shields.io/npm/dm/@coderbuzz/msgpack.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/coderbuzz/msgpack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/coderbuzz/msgpack.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/coderbuzz/msgpack"><img src="https://img.shields.io/github/stars/coderbuzz/msgpack.svg?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/coderbuzz/msgpack/actions/workflows/ci.yml"><img src="https://github.com/coderbuzz/msgpack/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/coderbuzz/msgpack"><img src="https://codecov.io/gh/coderbuzz/msgpack/graph/badge.svg" alt="Codecov" /></a>
</p>

`@coderbuzz/msgpack` is a purpose-built MessagePack encoder/decoder optimized for minimal GC pressure and maximum throughput. For structured API responses, compact objects are **~55% smaller** than JSON, and numeric arrays are **~60% smaller**.

---

## Why @coderbuzz/msgpack over @msgpack/msgpack or notepack?

| Pain Point | @msgpack/msgpack | notepack | **@coderbuzz/msgpack** |
|---|---|---|---|
| Buffer reuse | Allocates new buffer per encode | Partial | **Full** — internal buffer recycles across encode calls |
| Zero-copy encode | No | No | **`encodeUnsafe()`** — returns view of internal buffer, zero allocation |
| Pre-allocation | No | No | **`encodeInto()`** — writes to caller-owned buffer |
| Size pre-calculation | Manual estimate | Manual estimate | **`encodedSize()`** — exact byte count without allocating |
| Integer encoding | Standard | Standard | **Smallest possible** — auto-selects fixint/uint8/16/32/int8/16/32/float64 |
| Short ASCII strings | TextEncoder always | TextEncoder always | **Inline encoder** — avoids TextEncoder for strings <32 chars |
| Decode fast path | None | None | **ASCII scan** — `String.fromCharCode()` for strings ≤24 bytes |
| ESM only | Yes | CJS | Yes |
| Bundle size | ~10 KB gzip | ~5 KB | **<3 KB gzip** |

---

## Key Design Goals

- **Reusable internal buffer** — minimize GC pressure across encode calls
- **Smallest possible integer encoding** — auto-selects optimal MessagePack format
- **Zero-copy encode option** — `encodeUnsafe` for immediate consumption
- **Pre-allocation support** — `encodeInto` writes to a caller-owned buffer
- **Size pre-calculation** — `encodedSize` without allocating
- **Fast paths** — inline UTF-8 encoder for short strings, ASCII decoder for small strings

---

## Size Comparison vs JSON

| Payload type | JSON size | Msgpack size | Savings |
|---|---|---|---|
| Compact object `{ name, age, active }` | ~45 bytes | ~20 bytes | **~55%** |
| Numeric array `[1..1000]` | ~3.9 KB | ~1.5 KB | **~60%** |
| Structured API response (nested) | ~2 KB | ~1.3 KB | **~35%** |

### Throughput & Wire Size (Apple M-series, Bun)

Full results at **[github.com/coderbuzz/benchmarks](https://github.com/coderbuzz/benchmarks)**.

| Scenario | @coderbuzz/msgpack | @msgpack/msgpack | Factor |
|---|---|---|---|---|
| Nested object encode | **2.04M ops/s** | 0.77M | **2.7x** |
| Nested object decode | **0.90M ops/s** | 0.87M | **1.04x** |
| Wire size (nested object) | **133 bytes** | 133 bytes | Same |

> JSON.stringify/parse is faster (~4.78M encode, ~1.96M decode) but produces larger output (178 bytes) and lacks a binary contract.

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
// => Uint8Array (compact binary, ~20 bytes vs ~45 bytes JSON)

const value = decode(bytes);
// => { name: "Alice", age: 30, active: true }
```

---

## API Reference

### `encode(value: unknown): Uint8Array`

Encodes a JavaScript value to MessagePack binary format. Returns a **copy** of the internal buffer.

```ts
const bytes = encode({ hello: "world" });
```

**Supported types:**

| Type | Encoding |
|---|---|
| `null` / `undefined` | nil `0xc0` |
| `boolean` | `true` `0xc3` / `false` `0xc2` |
| `number` (integer) | Smallest: fixint, uint8/16/32, int8/16/32, or float64 |
| `number` (float) | float64 `0xcb` |
| `bigint` | uint64 `0xcf` or int64 `0xd3` |
| `string` | fixstr, str8, str16, or str32 |
| `Uint8Array` | bin8, bin16, or bin32 |
| `Date` | ISO string via `.toISOString()` |
| `Array` | fixarray, array16, or array32 (recursive) |
| `object` | fixmap, map16, or map32 (recursive) |

### `encodeUnsafe(value: unknown): Uint8Array`

Zero-copy encode — returns a **view** (`subarray`) of the internal buffer. No allocation for the output.

**WARNING:** Invalidated on the next `encode*` call. Only for immediate consumption.

```ts
// Good
socket.write(encodeUnsafe(data));

// Bad — will be corrupted
const unsafe = encodeUnsafe(data);
doSomethingLater(unsafe);
```

### `encodeInto(value: unknown, target: Uint8Array, offset?: number): number`

Encodes into a pre-allocated buffer. Returns bytes written.

```ts
const target = new Uint8Array(1024);
const written = encodeInto(payload, target, 0);
// target[0..written] contains encoded data
```

### `decode(data: Uint8Array): unknown`

Decodes MessagePack binary back to a JavaScript value.

```ts
const restored = decode(encode({ name: "Alice", age: 30 }));
// => { name: "Alice", age: 30 }
```

### `encodedSize(value: unknown): number`

Pre-calculates encoded byte size **without allocating** any output buffer.

```ts
const size = encodedSize({ name: "Alice", age: 30, scores: [1, 2, 3] });
const buffer = new Uint8Array(size);
encodeInto({ name: "Alice", age: 30, scores: [1, 2, 3] }, buffer);
```

`encodedSize(val) === encode(val).length` always holds.

---

## Wire Format Details

### Integer Encoding

| Range | Format | Bytes |
|---|---|---|
| `0` to `127` | fixint | 1 |
| `128` to `255` | uint8 | 2 |
| `256` to `65535` | uint16 | 3 |
| `65536` to `4294967295` | uint32 | 5 |
| `> 4294967295` | float64 | 9 |
| `-1` to `-32` | fixint | 1 |
| `-33` to `-128` | int8 | 2 |
| `-129` to `-32768` | int16 | 3 |
| `-32769` to `-2147483648` | int32 | 5 |
| `< -2147483648` | float64 | 9 |

### String Encoding

| Byte Length | Format | Header Size |
|---|---|---|
| 1–31 | fixstr | 1 byte |
| 32–255 | str8 | 2 bytes |
| 256–65535 | str16 | 3 bytes |
| > 65535 | str32 | 5 bytes |

**Performance:** Strings under 32 characters use inline UTF-8 (avoids `TextEncoder`). Decoder uses `String.fromCharCode()` for ASCII strings ≤24 bytes.

### Binary / Array / Map Encoding

All use the most compact header based on length/count.

---

## Advanced Usage

### Bulk Encoding with Buffer Reuse

```ts
for (const record of largeDataset) {
  const bytes = encode(record); // reuses internal buffer, only allocates .slice()
  await writeToStream(bytes);
}
```

### Pre-calculating Size for Batch Operations

```ts
function batchEncode(items: unknown[]): Uint8Array {
  let totalSize = 0;
  for (const item of items) totalSize += encodedSize(item);
  const batch = new Uint8Array(totalSize);
  let offset = 0;
  for (const item of items) offset += encodeInto(item, batch, offset);
  return batch;
}
```

---

## Edge Cases

| Input | Behavior |
|---|---|
| `undefined` | Encoded as nil (`0xc0`). Decodes as `null`. |
| `-0` | Preserved via float64. `Object.is(decode(encode(-0)), -0) === true`. |
| `NaN` | Lossless round-trip. |
| `Infinity` / `-Infinity` | Round-trips correctly. |
| Empty string/array/object | Encoded with minimum overhead. |
| Circular references | **Not detected.** Stack overflow. |

---

## Limitations

- **No MessagePack extension types** — Timestamp, custom extensions not supported. `Date` objects are ISO strings.
- **No streaming/SAX decoder** — Entire message in memory.
- **No bounds checking on decode** — Only decode trusted data.
- **No CJS build** — ESM only. Node.js 18+ with `"type": "module"`.

---

## License

MIT &copy; 2026 Indra Gunawan
