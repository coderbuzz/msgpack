<!-- docs: sync from coderbuzz/codex@b1e2bde -->

# Msgpack — AI Agent Knowledge File

**Package:** `@coderbuzz/msgpack`
**Purpose:** High-performance MessagePack serialization for TypeScript.\
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`). No source
`.ts` files in the package.

---

## Mental Model

`@coderbuzz/msgpack` is a **single-function library** with five exported
functions. It maintains a single reusable internal encoder buffer to minimize
allocations across encode calls.

```
encode(value)      → Uint8Array   (copy of internal buffer — safe to hold)
encodeUnsafe(value) → Uint8Array  (view into internal buffer — zero-copy, volatile)
encodeInto(v, t, o) → number      (write into pre-allocated buffer)
decode(data)       → unknown      (deserialize MessagePack bytes)
encodedSize(value) → number       (pre-calculate byte count without allocating)
```

All encoder operations share the same internal buffer (`buf`, `dv`, `pos`).
Each call resets `pos = 0`. The buffer starts at 64 KB and grows geometrically
(doubles) as needed.

---

## Import Map

```ts
import { decode, encode, encodedSize, encodeInto, encodeUnsafe } from "@coderbuzz/msgpack";
```

---

## API Reference

### `encode(value: unknown): Uint8Array`

Encodes any supported value to MessagePack binary. Returns a **copy** — safe
to store or pass to async consumers.

```ts
// Encode a simple value
const bytes = encode(42);
// Encode a structured object
const data = encode({ user: { name: "Alice", scores: [1, 2, 3] } });
```

**Rules:**
- `null` and `undefined` both encode as nil (`0xc0`).
- `Date` values encode as ISO strings via `.toISOString()` — NOT as MessagePack
  timestamp extension.
- `number` values > `Number.MAX_SAFE_INTEGER` lose precision. Use `bigint` for
  64-bit integers.
- `-0` is encoded as float64 to preserve sign.
- Objects with circular references will **stack overflow** — no detection.

---

### `encodeUnsafe(value: unknown): Uint8Array`

Zero-copy encode. Returns a **view** (`subarray`) into the internal buffer.

```ts
// Safe usage — immediate synchronous consumption
socket.write(encodeUnsafe(packet));

// UNSAFE — data will be corrupted on next encode
const unsafe = encodeUnsafe(data);
await sendLater(unsafe); // bug!
```

**Rule:** Only use when the bytes are consumed synchronously before the next
encode call (e.g., writing to a socket, passing to `fetch()` body).

---

### `encodeInto(value: unknown, target: Uint8Array, offset?: number): number`

Encodes into a caller-owned buffer. Useful for zero-allocation patterns.

```ts
const pool = new Uint8Array(65536);
let offset = 0;
for (const item of items) {
  offset += encodeInto(item, pool, offset);
}
send(pool.subarray(0, offset));
```

**Rules:**
- `offset` defaults to `0`.
- No bounds checking on `target` — caller is responsible for buffer size.
- Returns the number of bytes written.

---

### `decode(data: Uint8Array): unknown`

Deserializes MessagePack bytes back to a value.

```ts
const original = { hello: "world" };
const bytes = encode(original);
const restored = decode(bytes); // => { hello: "world" }
```

**Rules:**
- `undefined` values round-trip as `null` (MessagePack has no `undefined` type).
- Throws on unknown format byte: `"MessagePack: unknown format byte 0xNN at offset N"`.
- No bounds checking on `data`. Malformed input can cause out-of-bounds reads.

---

### `encodedSize(value: unknown): number`

Pre-calculates encoded size without allocating. Exact — `encodedSize(val) === encode(val).length`.

```ts
const size = encodedSize({ name: "Ken", age: 30 }); // pre-calc
const buffer = new Uint8Array(size);
encodeInto({ name: "Ken", age: 30 }, buffer);
```

Use for:
- Pre-allocating buffers for `encodeInto`
- Content-Length headers
- Batching decisions

---

## Supported Types & Wire Format

### null / undefined

| Value | Encoded |
|-------|---------|
| `null` | `0xc0` (1 byte) |
| `undefined` | `0xc0` (1 byte) |

### boolean

| Value | Encoded |
|-------|---------|
| `false` | `0xc2` (1 byte) |
| `true` | `0xc3` (1 byte) |

### number (integer)

Smallest representation is auto-selected:

| Range | Format | Bytes |
|-------|--------|-------|
| `0..127` | positive fixint | 1 |
| `128..255` | uint8 `0xcc` | 2 |
| `256..65535` | uint16 `0xcd` | 3 |
| `65536..4294967295` | uint32 `0xce` | 5 |
| `> 4294967295` | float64 `0xcb` | 9 |
| `-1..-32` | negative fixint | 1 |
| `-33..-128` | int8 `0xd0` | 2 |
| `-129..-32768` | int16 `0xd1` | 3 |
| `-32769..-2147483648` | int32 `0xd2` | 5 |
| `< -2147483648` | float64 `0xcb` | 9 |

### number (float)

All non-integer numbers use float64 (`0xcb`, 9 bytes).

### bigint

| Value | Format | Bytes |
|-------|--------|-------|
| `>= 0n` | uint64 `0xcf` | 9 |
| `< 0n` | int64 `0xd3` | 9 |

### string

| UTF-8 Byte Length | Format | Header Size |
|-------------------|--------|-------------|
| 1–31 | fixstr `0xa0\|len` | 1 |
| 32–255 | str8 `0xd9` | 2 |
| 256–65535 | str16 `0xda` | 3 |
| > 65535 | str32 `0xdb` | 5 |

### Uint8Array

| Length | Format | Header Size |
|--------|--------|-------------|
| 1–255 | bin8 `0xc4` | 2 |
| 256–65535 | bin16 `0xc5` | 3 |
| > 65535 | bin32 `0xc6` | 5 |

### Array

| Count | Format | Header Size |
|-------|--------|-------------|
| 0–15 | fixarray `0x90\|len` | 1 |
| 16–65535 | array16 `0xdc` | 3 |
| > 65535 | array32 `0xdd` | 5 |

### object (map)

| Key Count | Format | Header Size |
|-----------|--------|-------------|
| 0–15 | fixmap `0x80\|len` | 1 |
| 16–65535 | map16 `0xde` | 3 |
| > 65535 | map32 `0xdf` | 5 |

---

## Common Patterns

### Encode for HTTP Response

```ts
import { encode } from "@coderbuzz/msgpack";

const data = { status: "ok", data: results };
new Response(encode(data), {
  headers: { "Content-Type": "application/msgpack" },
});
```

### Zero-Copy Socket Write

```ts
import { encodeUnsafe } from "@coderbuzz/msgpack";

function send(socket: WebSocket, msg: unknown) {
  socket.send(encodeUnsafe(msg)); // safe — send is synchronous
}
```

### Pooled Encoding

```ts
import { encode, encodeInto, encodedSize } from "@coderbuzz/msgpack";

function encodeBatch(items: unknown[]): Uint8Array {
  const sizes = items.map(encodedSize);
  const total = sizes.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < items.length; i++) {
    offset += encodeInto(items[i], buf, offset);
  }
  return buf;
}
```

### Compare with JSON

```ts
import { encode } from "@coderbuzz/msgpack";

const data = { a: 1, b: 2, c: true };
const msgpackBytes = encode(data);      // ~10-12 bytes
const jsonBytes = new TextEncoder().encode(JSON.stringify(data)); // ~18-20 bytes
```

---

## Edge Cases & Rules

| Scenario | Behavior |
|----------|----------|
| `undefined` → encode → decode | Returns `null` (lossy) |
| `-0` → encode → decode | Preserved (`Object.is(val, -0) === true`) |
| `NaN` → encode → decode | Preserved (`Number.isNaN(val) === true`) |
| Circular reference | Stack overflow (not caught) |
| Truncated/malformed input | Out-of-bounds read (no bounds check) |
| Very large array (> 2^32) | Not supported (JS limit) |
| `Date` object | Encoded as ISO string, NOT timestamp ext |
| `Symbol`, `Map`, `Set` | Not supported — will fail type check |

---

## Error Handling

`@coderbuzz/msgpack` does minimal error checking:

```ts
try {
  const bytes = encode(data);
  const decoded = decode(bytes);
} catch (err) {
  // err may be:
  //   Error("MessagePack: unknown format byte 0xNN at offset N")
  //   RangeError (from DataView when reading past buffer)
  //   TypeError (from property access on unexpected types)
}
```

For decoding untrusted data, wrap in try-catch. The decoder has no bounds
checking — malformed data may produce `RangeError` from `DataView` methods.

---

## Internal Buffer Details

### Growth Algorithm

The encoder uses a single module-level reusable buffer (`buf: Uint8Array`, `dv: DataView`, `pos: number`). All encode functions share these globals — thread-safe because JS is single-threaded.

```
Initial: buf = new Uint8Array(65536)  // 64 KB
On overflow: buf = new Uint8Array(buf.length * 2)  // double
```

The buffer never shrinks. It grows geometrically (doubles) when `pos + needed > buf.length`. After many large encodes, the buffer stabilizes at the peak size needed.

**Lifecycle:**
1. `encode()` call → `pos = 0`
2. Write header + value(s) → `pos` advances
3. Return `buf.slice(0, pos)` — copy for safety
4. `encodeUnsafe()` returns `buf.subarray(0, pos)` — view, zero-copy

### Encoding Decision Tree

```
value to encode
  ├─ typeof v === "undefined" || v === null  → write 0xc0 (nil)
  ├─ typeof v === "boolean"                   → write 0xc2/0xc3
  ├─ typeof v === "number"
  │   ├─ Number.isInteger(v) && in varint range → smallest fixint/uint/int
  │   └─ else                                   → float64 (0xcb)
  ├─ typeof v === "string"
  │   ├─ len < 32 → inline UTF-8 encoder (no TextEncoder)
  │   ├─ len < 256 → str8 (0xd9)
  │   ├─ len < 65536 → str16 (0xda)
  │   └─ len >= 65536 → str32 (0xdb)
  ├─ typeof v === "bigint"
  │   ├─ v >= 0n → uint64 (0xcf)
  │   └─ v < 0n  → int64 (0xd3)
  ├─ v instanceof Uint8Array → bin8/16/32 based on length
  ├─ v instanceof Date → ISO string via .toISOString()
  ├─ Array.isArray(v) → fixarray/array16/32 + recursive encode
  └─ typeof v === "object" → fixmap/map16/32 + recursive encode keys+values
```

### Decode Decision Tree

```
decode byte at position
  ├─ 0xc0 → return null (nil)
  ├─ 0xc2/0xc3 → return false/true
  ├─ 0xca → read float32 (4 bytes)
  ├─ 0xcb → read float64 (8 bytes)
  ├─ 0xcc..0xcf → read uint8/16/32/64
  ├─ 0xd0..0xd3 → read int8/16/32/64
  ├─ 0xa0..0xbf (fixstr) → read string of length (byte & 0x1f)
  ├─ 0xd9..0xdb (str8/16/32) → read string with header length
  ├─ 0xc4..0xc6 (bin8/16/32) → return Uint8Array
  ├─ 0x90..0x9f (fixarray) → read array of length (byte & 0x0f), recurse
  ├─ 0xdc..0xdd (array16/32) → read array with header length, recurse
  ├─ 0x80..0x8f (fixmap) → read map of length (byte & 0x0f), recurse key+value
  ├─ 0xde..0xdf (map16/32) → read map with header length, recurse key+value
  └─ default → throw "MessagePack: unknown format byte 0xNN at offset N"
```

**ASCII fast path (decode):** Strings ≤24 bytes where all bytes are ≤ 0x7F use `String.fromCharCode()` directly — avoids `TextDecoder`.

### Performance Characteristics

| Operation | Hot Path | Allocations |
|---|---|---|
| `encode(v)` | Inline write to `DataView` | 1 (`.slice()` copy) |
| `encodeUnsafe(v)` | Inline write to `DataView` | 0 |
| `encodeInto(v, buf, off)` | Inline write to `DataView` | 0 (caller buffer) |
| `decode(data)` | `DataView` reads + recursive object/array construction | N (one per decoded value) |
| `encodedSize(v)` | Arithmetic calculation (no writes) | 0 |

The encoder is allocation-minimal: one `.slice()` for safe encode, zero for unsafe/pre-allocated modes. The decoder must allocate objects/arrays/strings but avoids parser overhead. Strings ≤24 ASCII chars skip `TextDecoder` allocation.

---

## Benchmark Methodology Notes

All benchmarks run on Apple M-series, Bun runtime. Measurements:
- **ops/s** = operations per second (higher is better)
- **Wire size** = raw byte count of encoded output (lower is better)

vs `@msgpack/msgpack`:
- Encode: 2.04M ops/s vs 0.77M (2.7x faster) — buffer reuse + inline UTF-8
- Decode: 0.90M ops/s vs 0.87M (1.04x faster) — ASCII fast path
- Wire size: identical (same MessagePack spec)

vs JSON:
- Encode: 4.78M ops/s faster (native, in C)
- Decode: 1.96M ops/s faster (native, in C)
- Wire size: msgpack is 35-60% smaller (no field names, compact numerics)
