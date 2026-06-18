<!-- docs: sync from coderbuzz/codex@76ca592 -->

# Msgpack — `@coderbuzz/msgpack`

High-performance [MessagePack](https://msgpack.org) serialization for TypeScript.
Encodes and decodes JSON-compatible values to compact binary representation,
optimized for minimal allocations and fast throughput.

**Key design goals:**
- Reusable internal buffer — minimize GC pressure across encode calls
- Smallest possible integer encoding — auto-selects optimal MessagePack format
- Zero-copy encode option — `encodeUnsafe` for immediate consumption
- Pre-allocation support — `encodeInto` writes to a caller-owned buffer
- Size pre-calculation — `encodedSize` without allocating

**Comparison with JSON (from benchmarks):**
- Compact objects: ~55% smaller
- Numeric arrays: ~60% smaller
- Structured API responses: ~30-40% smaller

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
// => Uint8Array (compact binary representation)

const value = decode(bytes);
// => { name: "Alice", age: 30, active: true }
```

---

## API Reference

### `encode(value: unknown): Uint8Array`

Encodes a JavaScript value to MessagePack binary format. Returns a **copy** of
the internal buffer. The returned `Uint8Array` is owned by the caller and will
not be invalidated by subsequent encode calls.

```ts
const bytes = encode({ hello: "world" });
// bytes is a new Uint8Array, safe to hold onto
```

**Supported types:**

| Type | Encoding |
|------|----------|
| `null` / `undefined` | nil `0xc0` |
| `boolean` | `true` `0xc3` / `false` `0xc2` |
| `number` (integer) | Smallest possible: fixint, uint8/16/32, int8/16/32, or float64 |
| `number` (float) | float64 `0xcb` |
| `bigint` | uint64 `0xcf` or int64 `0xd3` |
| `string` | fixstr, str8, str16, or str32 |
| `Uint8Array` | bin8, bin16, or bin32 |
| `Date` | Encoded as ISO string via `.toISOString()` |
| `Array` | fixarray, array16, or array32 with recursively encoded elements |
| `object` | fixmap, map16, or map32 with string keys and recursively encoded values |

---

### `encodeUnsafe(value: unknown): Uint8Array`

Encodes the value and returns a **view** (`subarray`) of the internal buffer.
This is a zero-copy operation — no allocation is performed for the output.

**WARNING:** The returned `Uint8Array` is invalidated on the next call to any
`encode*` function. Only use this when you can consume the bytes immediately
(e.g., writing to a socket, passing to a synchronous consumer).

```ts
// Good: immediate consumption
socket.write(encodeUnsafe(data));

// Bad: holding onto the reference
const unsafe = encodeUnsafe(data);
doSomethingLater(unsafe); // unsafe is now corrupted
```

---

### `encodeInto(value: unknown, target: Uint8Array, offset?: number): number`

Encodes the value into a **pre-allocated** buffer at the given offset. Returns
the number of bytes written. Useful for zero-allocation serialization in
high-throughput scenarios where you manage your own buffer pool.

```ts
const target = new Uint8Array(1024);
const written = encodeInto(payload, target, 0);
// target[0..written] contains the encoded data
```

The internal buffer is still used as a scratch space during encoding, then the
result is copied to `target`. The `target` buffer must be large enough to hold
the encoded value at the given offset — no bounds checking is performed.

---

### `decode(data: Uint8Array): unknown`

Decodes a MessagePack binary buffer back into a JavaScript value. Handles all
formats produced by `encode`.

```ts
const original = { name: "Alice", age: 30 };
const bytes = encode(original);
const restored = decode(bytes);
// restored => { name: "Alice", age: 30 }
```

**Decoder characteristics:**
- Recursive descent parser — handles arbitrarily nested structures
- Thread-safe (no shared mutable state during decode)
- **No bounds checking** — malformed/truncated input may cause out-of-bounds reads

---

### `encodedSize(value: unknown): number`

Pre-calculates the encoded byte size **without allocating** any output buffer.
This is useful for:
- Pre-allocating buffers for `encodeInto`
- Estimating payload sizes for content-length headers
- Batching decisions (e.g., splitting large payloads)

```ts
const size = encodedSize({ name: "Alice", age: 30, scores: [1, 2, 3] });
const buffer = new Uint8Array(size);
encodeInto({ name: "Alice", age: 30, scores: [1, 2, 3] }, buffer);
```

The `encodedSize` function follows the exact same encoding logic as `encode`,
so `encodedSize(val) === encode(val).length` always holds.

---

## Wire Format Details

### Integer Encoding

`@coderbuzz/msgpack` always selects the **smallest** possible representation for
integer values:

| Value Range | Format | Bytes |
|-------------|--------|-------|
| `0` to `127` | positive fixint | 1 |
| `128` to `255` | uint8 | 2 |
| `256` to `65535` | uint16 | 3 |
| `65536` to `4294967295` | uint32 | 5 |
| `> 4294967295` | float64 | 9 |
| `-1` to `-32` | negative fixint | 1 |
| `-33` to `-128` | int8 | 2 |
| `-129` to `-32768` | int16 | 3 |
| `-32769` to `-2147483648` | int32 | 5 |
| `< -2147483648` | float64 | 9 |

**Integer precision notes:**
- Values > `Number.MAX_SAFE_INTEGER` (2^53 − 1) may lose precision when
  round-tripped as `number`. Use `bigint` for values requiring full 64-bit
  precision.
- `0` is encoded as positive fixint. `-0` is encoded as float64 to preserve
  the sign bit (`Object.is(0, -0) === false`).
- `Infinity` and `-Infinity` are encoded as float64.
- `NaN` is encoded as float64.

### String Encoding

Strings use the most compact format based on UTF-8 byte length:

| Byte Length | Format | Header Size |
|-------------|--------|-------------|
| 1–31 | fixstr | 1 byte (`0xa0 \| len`) |
| 32–255 | str8 | 2 bytes (`0xd9 + len`) |
| 256–65535 | str16 | 3 bytes (`0xda + uint16`) |
| > 65535 | str32 | 5 bytes (`0xdb + uint32`) |

**Performance optimization:**
- Strings under 32 characters use an inline UTF-8 encoder that avoids
  `TextEncoder` overhead.
- The decoder uses a fast ASCII scan for strings <= 24 bytes — if all bytes are
  ASCII, it builds the string with `String.fromCharCode()` instead of
  `TextDecoder`.

### Binary (Uint8Array) Encoding

| Length | Format | Header Size |
|--------|--------|-------------|
| 1–255 | bin8 | 2 bytes (`0xc4 + len`) |
| 256–65535 | bin16 | 3 bytes (`0xc5 + uint16`) |
| > 65535 | bin32 | 5 bytes (`0xc6 + uint32`) |

### Array Encoding

| Element Count | Format | Header Size |
|---------------|--------|-------------|
| 0–15 | fixarray | 1 byte (`0x90 \| len`) |
| 16–65535 | array16 | 3 bytes (`0xdc + uint16`) |
| > 65535 | array32 | 5 bytes (`0xdd + uint32`) |

### Map (Object) Encoding

| Key Count | Format | Header Size |
|-----------|--------|-------------|
| 0–15 | fixmap | 1 byte (`0x80 \| len`) |
| 16–65535 | map16 | 3 bytes (`0xde + uint16`) |
| > 65535 | map32 | 5 bytes (`0xdf + uint32`) |

Object keys are always encoded as strings. Values are recursively encoded.

---

## Advanced Usage

### Bulk Encoding with Buffer Reuse

The internal encoder buffer is reusable across calls. Each `encode*` call resets
the write position to `0`, so the same 64 KB initial buffer grows only when
needed. This means encoding thousands of values sequentially is efficient:

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
  for (const item of items) {
    offset += encodeInto(item, batch, offset);
  }
  return batch;
}
```

---

## Edge Cases

| Input | Behavior |
|-------|----------|
| `undefined` | Encoded as nil (`0xc0`). Decodes as `null`. |
| `-0` | Preserved via float64 encoding. `Object.is(decode(encode(-0)), -0) === true`. |
| `NaN` | Encoded and decoded losslessly. `Number.isNaN(decode(encode(NaN))) === true`. |
| `Infinity` / `-Infinity` | Encoded as float64, round-trips correctly. |
| Empty string `""` | Encoded as fixstr with length 0 (`0xa0`). |
| Empty array `[]` | Encoded as fixarray with count 0 (`0x90`). |
| Empty object `{}` | Encoded as fixmap with count 0 (`0x80`). |
| Empty `Uint8Array` | Encoded as bin8 with length 0 (`0xc4, 0x00`). |
| Large payloads | Buffer grows geometrically (doubles). A ~500 KB payload round-trips correctly and is smaller than equivalent JSON. |
| Circular references | **Not detected.** Will cause stack overflow. |
| Unknown format byte | Decoder throws `Error("MessagePack: unknown format byte 0xNN at offset N")`. |

---

## Limitations

- **No MessagePack extension types** — Timestamp, custom extensions, etc. are not
  supported. `Date` objects are encoded as ISO strings, not the MessagePack
  timestamp extension.
- **No streaming/SAX decoder** — The entire message must be in memory for
  decoding.
- **No bounds checking on decode** — Malformed input can cause out-of-bounds
  reads. Only decode trusted data.
- **No CJS build** — ESM only (`"type": "module"`). Node.js 18+ with
  `"type": "module"` in package.json, or `.mjs` extension required.

---

## License

MIT &copy; 2026 Indra Gunawan
