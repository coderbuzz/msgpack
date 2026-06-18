<!-- docs: sync from coderbuzz/codex@0063efc -->

# Msgpack &mdash; `@coderbuzz/msgpack`

High-performance [MessagePack](https://msgpack.org) serialization for
TypeScript.

Encodes and decodes JSON-compatible values to compact binary representation,
optimized for minimal allocations and fast throughput.

## Highlights

- Full MessagePack spec support: nil, bool, int, float, string, binary, array,
  map
- Reusable encoder buffer to minimize GC pressure
- Fast ASCII string path for short strings (common JSON keys)
- Compile-time branching for smallest integer representation
- Manual UTF-8 encoding for short strings, `TextEncoder` fallback for long ones
- `encodeUnsafe` zero-copy path for immediate consumption (e.g. writing to a
  socket)
- `encodeInto` for writing into a pre-allocated buffer
- `encodedSize` for pre-calculating byte length without allocating

## Installation

```sh
# npm
npm install @coderbuzz/msgpack

# Bun
bun add @coderbuzz/msgpack

# Deno
import { encode, decode } from "npm:@coderbuzz/msgpack";
```

## Usage

### Encode & Decode

```ts
import { decode, encode } from "@coderbuzz/msgpack";

const bytes = encode({ name: "Alice", age: 30, active: true });
// => Uint8Array (compact binary)

const value = decode(bytes);
// => { name: 'Alice', age: 30, active: true }
```

### Zero-Copy Encode

```ts
import { encodeUnsafe } from "@coderbuzz/msgpack";

// Returns a view into the internal buffer — NOT a copy.
// Must be consumed before the next encode() call.
const view = encodeUnsafe(payload);
socket.write(view);
```

### Encode Into Pre-Allocated Buffer

```ts
import { encodeInto } from "@coderbuzz/msgpack";

const target = new Uint8Array(1024);
const bytesWritten = encodeInto(payload, target, 0);
```

### Pre-Calculate Encoded Size

```ts
import { encodedSize } from "@coderbuzz/msgpack";

const size = encodedSize(payload);
const buf = new Uint8Array(size);
encodeInto(payload, buf);
```

## Supported Types

| TypeScript type      | MessagePack format                                |
| -------------------- | ------------------------------------------------- |
| `null` / `undefined` | nil (`0xc0`)                                      |
| `boolean`            | true / false                                      |
| `number` (integer)   | positive/negative fixint, uint8/16/32, int8/16/32 |
| `number` (float)     | float64                                           |
| `bigint`             | int64 / uint64                                    |
| `string`             | fixstr, str8, str16, str32                        |
| `Uint8Array`         | bin8, bin16, bin32                                |
| `Date`               | encoded as ISO string                             |
| `Array`              | fixarray, array16, array32                        |
| `object`             | fixmap, map16, map32                              |

## API

```ts
// Encode a value, returning a new Uint8Array (caller owns memory)
function encode(value: unknown): Uint8Array;

// Encode a value, returning a view into the internal buffer (zero-copy)
// WARNING: invalidated by the next encode/encodeUnsafe call
function encodeUnsafe(value: unknown): Uint8Array;

// Encode a value into an existing buffer, returns bytes written
function encodeInto(
  value: unknown,
  target: Uint8Array,
  offset?: number,
): number;

// Decode a MessagePack buffer back to a value
function decode(data: Uint8Array): unknown;

// Calculate encoded byte size without allocating
function encodedSize(value: unknown): number;
```

## License

MIT © 2026 Indra Gunawan
