<!-- docs: sync from coderbuzz/codex@a2d275a -->

# Msgpack: AI Agent Knowledge File

**Package:** `@coderbuzz/msgpack`
**Purpose:** MessagePack serialization for TypeScript, safe on untrusted input.
**Runtimes:** Bun, Node.js 18+, Deno (`npm:@coderbuzz/msgpack`). Verified on Bun 1.4.2, Node 26.10.0 and Deno 2.9.7 (`tests/runtimes.test.ts` runs the same checks on all three).
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`, built by `Bun.build` + `tsc`; `validate-publish` enforces ES2022 syntax). The source map embeds the TypeScript source (`sourcesContent`). No dependencies.

---

## Mental Model

```
encode(value)              → Uint8Array            copy, caller owns it
encodeUnsafe(value)        → Uint8Array            view into the encoder buffer, overwritten by the next call
encodeInto(v, target, off) → number                bytes written into target
encodedSize(value)         → number                exact encode(value).length
decode(data)               → unknown               exactly one value; trailing bytes are an error
decodeMulti(data)          → unknown[]             all concatenated values
decodeAt(data, offset)     → { value, end }        one value from offset, and where it ended

new Encoder(options) → { encode, encodeUnsafe, encodeInto, encodedSize }   own buffer + options, methods bound
new Decoder(options) → { decode, decodeMulti, decodeAt }                  own options, methods bound
```

The top-level functions use one default `Encoder` and one default `Decoder` (default options).

Two rules drive every behavior:

1. **Decoding is safe on untrusted bytes.** Bounds checks on every read, no allocation larger than the input, nesting limit, optional length limits, `__proto__` as data, and one error class (`MsgpackDecodeError`) for everything malformed.
2. **No silent failures.** A value the format cannot carry throws `MsgpackEncodeError` with its path, unless you opt into `unsupported: 'ignore'`.

---

## Import Map

```ts
import {
  // functions (default options)
  encode, encodeUnsafe, encodeInto, encodedSize,
  decode, decodeMulti, decodeAt,
  // configurable instances
  Encoder, Decoder,
  // errors
  MsgpackDecodeError, MsgpackEncodeError,
  // ext values
  MsgpackExt,
  // types
  type EncoderOptions, type DecoderOptions, type Extension,
  type MsgpackDecodeErrorCode, type MsgpackEncodeErrorCode,
} from "@coderbuzz/msgpack";
```

---

## API Reference

### `encode(value: unknown): Uint8Array`

Encodes to a **new** `Uint8Array` (a copy of the encoder buffer). Safe to store or pass to async consumers.

### `encodeUnsafe(value: unknown): Uint8Array`

Returns `buf.subarray(0, length)` of the encoder's internal buffer. The next `encode`, `encodeUnsafe` or `encodeInto` call on the **same encoder** overwrites it (`encodedSize` uses a separate scratch buffer, so it does not). Verified behavior of consumers (Bun 1.4.2, Node 26.10.0, Deno 2.9.7):

| Consumer | Copies synchronously? | Safe with `encodeUnsafe`? |
|---|---|---|
| `new Response(view)` | yes (Bun, Node, Deno) | yes |
| `new Request(url, { body: view })` / `fetch` body | yes (Bun, Node) | yes |
| `new Blob([view])` | yes | yes |
| Bun `ServerWebSocket.send(view)` | yes (0/2000 frames wrong under load) | yes |
| Node `net.Socket.write(view)` (also under Bun and Deno) | **no**: 1019/2000 (Node), 1024/2000 (Bun), 1999/2000 (Deno) frames carried another message | **no**, use `encode()` |
| Node `stream.Writable.write(view)` | **no** | **no** |

**Never use `.buffer`** of the returned view: it is the whole internal buffer (64 KB or more) and contains bytes from earlier encodes, possibly other requests' data.

If an encoder buffer grew beyond 1 MiB, it is replaced by a fresh 64 KB buffer after the call. The view returned by that call still points at the large buffer and stays valid until you drop it.

### `encodeInto(value: unknown, target: Uint8Array, offset = 0): number`

Encodes into the encoder buffer, then copies into `target` at `offset`. Returns the byte count.
- `offset` must be an integer in `0..target.length`, else `RangeError`.
- If the result does not fit: `RangeError("encodeInto() target too small: N bytes needed at offset O, M available")`, and nothing is written to `target`.
- It reuses the encoder buffer, so it invalidates an earlier `encodeUnsafe` view of the same encoder.

### `encodedSize(value: unknown): number`

Exact: implemented as `scratch.encodeUnsafe(value).length` on a private scratch encoder with the same options. It therefore throws exactly when `encode` throws, runs getters and `toJSON()` like `encode`, and costs about one encode. Measured against the 0.1.x arithmetic version: slower for object payloads (nested 1.34 µs vs 0.58 µs, 100 rows 56 µs vs 46 µs), 25x faster for a 2.3 KB string (0.2 µs vs 5.1 µs). The old version was not exact (unpaired surrogates, functions). It does not disturb `encodeUnsafe` views.

### `decode(data: Uint8Array): unknown`

Decodes **exactly one** value. Any byte left after it → `MsgpackDecodeError` `TRAILING_BYTES`. Non-`Uint8Array` input (Node `Buffer` is fine) → `TypeError`.

### `decodeMulti(data: Uint8Array): unknown[]`

Decodes values until the end of the buffer. `[]` for empty input. A truncated last value throws `TRUNCATED`.

### `decodeAt(data: Uint8Array, offset = 0): { value: unknown; end: number }`

Decodes one value starting at `offset` and returns the offset just past it. Bytes after `end` are ignored. Use it to read framed streams:

```ts
let buf = new Uint8Array(0);
function onChunk(chunk: Uint8Array) {
  buf = concat(buf, chunk);
  let offset = 0;
  while (offset < buf.length) {
    try {
      const { value, end } = decodeAt(buf, offset);
      handle(value);
      offset = end;
    } catch (err) {
      if (err instanceof MsgpackDecodeError && err.code === "TRUNCATED") break; // wait for more bytes
      throw err;
    }
  }
  buf = buf.subarray(offset);
}
```

Cap the size of `buf` yourself: `TRUNCATED` can also mean a header claims more data than will ever arrive.

---

## Encoder Options

```ts
interface EncoderOptions {
  unsupported?: 'throw' | 'ignore';   // default 'throw'
  ignoreUndefined?: boolean;          // default false
  sortKeys?: boolean;                 // default false
  date?: 'string' | 'timestamp';      // default 'string'
  largeInt?: 'float64' | 'int64';     // default 'float64'
  maxDepth?: number;                  // default 512, positive integer
  extensions?: readonly Extension[];  // default []
}
```

- **`unsupported: 'ignore'`**: object keys whose value is unsupported (function, symbol, `Set`, class instance without `toJSON`, ...) are **omitted**, and in arrays the element becomes nil, like `JSON.stringify`. Other errors (`BIGINT_RANGE`, `MAX_DEPTH`, `INVALID_DATE`) still throw.
- **`ignoreUndefined`**: omit object keys whose value is `undefined`. Array elements stay nil. When filtering (either option), each property is read once, so getters run once.
- **`sortKeys`**: plain-object keys in `Array.prototype.sort()` order (UTF-16 code units). `Map` keeps insertion order.
- **`date: 'timestamp'`**: Timestamp ext (type -1), millisecond precision: timestamp 32 (`d6 ff` + u32 sec) when the ms part is 0 and 0 ≤ sec < 2^32; timestamp 64 (`d7 ff` + (nsec << 34 | sec)) when 0 ≤ sec < 2^34; timestamp 96 (`c7 0c ff` + u32 nsec + i64 sec) otherwise (including before 1970).
- **`largeInt: 'int64'`**: integers with |n| > 2^32 and within `Number.MAX_SAFE_INTEGER` as uint64 (`cf`) / int64 (`d3`). Beyond the safe range the number is not an exact integer anyway, so it stays float64. Pair with `new Decoder({ int64: 'auto' })` to get `number` back.
- **`maxDepth`**: containers (array, object, Map, and each `toJSON()` step) nested deeper than this throw `MAX_DEPTH`. A circular reference hits it. The encoder and decoder defaults agree (512), so anything the default encoder writes, the default decoder reads.
- Invalid option values throw `RangeError`/`TypeError` at construction.

## Decoder Options

```ts
interface DecoderOptions {
  int64?: 'bigint' | 'auto' | 'number';  // default 'bigint'
  mapAs?: 'object' | 'map';              // default 'object'
  copyBinary?: boolean;                  // default true
  strictUtf8?: boolean;                  // default false
  maxDepth?: number;                     // default 512
  maxStrLength?: number;                 // bytes, default Infinity
  maxBinLength?: number;                 // bytes, default Infinity
  maxArrayLength?: number;               // elements, default Infinity
  maxMapLength?: number;                 // entries, default Infinity
  maxExtLength?: number;                 // bytes, default Infinity
  extensions?: readonly Extension[];
}
```

- **`int64`**: `'bigint'` always returns `bigint` for `cf`/`d3` (round-trips `bigint` input). `'auto'` returns `number` when the value is a safe integer, else `bigint`. `'number'` returns `number` and throws `UNSAFE_INTEGER` when it would lose precision.
- **`mapAs: 'object'`** (default): keys must be strings or numbers (numbers and 64-bit integers are stringified). Any other key type (nil, boolean, array, map, bin, ext) throws `INVALID_KEY` instead of silently colliding as `"[object Object]"`. **`'map'`** returns `Map` with keys as decoded (arrays and maps as keys are compared by identity, as `Map` does).
- **`copyBinary: false`**: bin and ext payloads are `subarray` views into the input (measured: 64 KB bin decodes in 0.17 µs instead of 7.6 µs). They change if the input buffer is reused, and they keep the whole input alive.
- **`strictUtf8`**: invalid UTF-8 throws `INVALID_UTF8`. Default replaces with U+FFFD, as `TextDecoder` does.
- **Limits** are checked from the header, before any allocation, and throw `LIMIT_EXCEEDED`. Without limits, memory is still bounded by the input size (see Safety).

## Extensions

```ts
interface Extension {
  type: number;                          // 0..127 (negative types are reserved by the spec)
  match?: (value: object) => boolean;    // encoder: which objects this handles
  encode?: (value: any) => Uint8Array;   // required when match is set
  decode?: (data: Uint8Array) => unknown;
}
```

- The encoder asks `match` only for objects that are not arrays, `Uint8Array`, or plain objects, and before its built-in handling of `Date`, `Map`, etc., so an extension can take over `Date`.
- `encode` must return a `Uint8Array`, else `INVALID_EXT`.
- On decode, a registered `type` calls `decode(bytes)` (a copy unless `copyBinary: false`). It may call `decode()` itself: nested decoding runs on fresh state.
- An ext type with no registered decoder becomes `new MsgpackExt(type, data)`. Encoding a `MsgpackExt` writes it back byte for byte, so unknown extensions pass through.
- Construction rejects types outside 0..127, duplicates, and `match` without `encode`.

---

## Errors

```ts
class MsgpackDecodeError extends Error {
  name: 'MsgpackDecodeError';
  code: MsgpackDecodeErrorCode;
  offset: number;   // byte offset where the problem was found
}
class MsgpackEncodeError extends Error {
  name: 'MsgpackEncodeError';
  code: MsgpackEncodeErrorCode;
  path: (string | number)[];   // e.g. ["items", 0, "onSave"]
  detail: string;              // message without the path
}
```

Messages never contain payload content, only the problem and the offset or path, so they are safe to log.

| Decode code | When | `offset` |
|---|---|---|
| `TRUNCATED` | input ends inside a value, or a length header claims more than is left (an array of n elements needs ≥ n bytes, a map ≥ 2n) | where the missing bytes were expected |
| `INVALID_FORMAT` | format byte `0xc1` (never used by the spec) | the format byte |
| `TRAILING_BYTES` | `decode()` found bytes after the value | first extra byte |
| `MAX_DEPTH` | nesting deeper than `maxDepth` | at the container header |
| `LIMIT_EXCEEDED` | a `max*Length` limit | after the header |
| `INVALID_KEY` | a map key that is not a string or number (in `mapAs: 'object'`) | the key |
| `INVALID_UTF8` | invalid UTF-8 with `strictUtf8` | string data |
| `UNSAFE_INTEGER` | `int64: 'number'` and the value exceeds 2^53 − 1 | the format byte |
| `INVALID_EXT` | Timestamp with a length other than 4/8/12, nanoseconds > 999 999 999, or outside the `Date` range | the ext type byte |

| Encode code | When |
|---|---|
| `UNSUPPORTED_TYPE` | function, symbol, `Set`, `WeakMap`, `Promise`, `RegExp`, `Error`, class instance without `toJSON()` |
| `BIGINT_RANGE` | bigint outside −2^63 .. 2^64 − 1 |
| `MAX_DEPTH` | nesting deeper than `maxDepth` (circular reference) |
| `INVALID_DATE` | `new Date(NaN)` |
| `INVALID_EXT` | an extension's `encode()` did not return a `Uint8Array` |

Example: `encode({ rows: [{ ok: 1 }, { amount: 10n ** 40n }] })` throws `MessagePack encode: bigint outside the int64/uint64 range at $.rows[1].amount`.

HTTP mapping: a `MsgpackDecodeError` on a request body is the client's fault (400); a `MsgpackEncodeError` is a server bug (500).

---

## Supported Types & Wire Format

### Encoding

| Value | Format | Notes |
|---|---|---|
| `null`, `undefined` | nil `c0` | `undefined` keys omitted with `ignoreUndefined` |
| `false` / `true` | `c2` / `c3` | |
| integer 0..127 | positive fixint | 1 byte |
| 128..255 / ..65535 / ..4294967295 | uint8 `cc` / uint16 `cd` / uint32 `ce` | |
| −1..−32 | negative fixint | |
| −33..−128 / ..−32768 / ..−2147483648 | int8 `d0` / int16 `d1` / int32 `d2` | |
| other integers | float64 `cb` (9 bytes) | uint64 `cf` / int64 `d3` with `largeInt: 'int64'` |
| other numbers, `-0`, `NaN`, `±Infinity` | float64 `cb` | |
| `bigint` ≥ 0 / < 0 | uint64 `cf` / int64 `d3` | outside 64 bits throws |
| `string` | fixstr `a0-bf` (< 32 bytes), str8 `d9`, str16 `da`, str32 `db` | UTF-8; unpaired surrogates → U+FFFD (`ef bf bd`) |
| `Uint8Array` (incl. Node `Buffer`) | bin8 `c4`, bin16 `c5`, bin32 `c6` | |
| other `ArrayBuffer` views (`Float64Array`, `DataView`, ...), `ArrayBuffer`, `SharedArrayBuffer` | bin | raw bytes in platform byte order; decodes as `Uint8Array` |
| `Date` | ISO 8601 string | Timestamp ext with `date: 'timestamp'`; invalid date throws |
| `Array` | fixarray `90-9f`, array16 `dc`, array32 `dd` | holes → nil |
| plain object (prototype `Object.prototype`, `null`, or a plain object from another realm) | fixmap `80-8f`, map16 `de`, map32 `df` | own enumerable string keys (`Object.keys`) |
| `Map` | map | keys encoded as values (any type) |
| `MsgpackExt` | fixext1/2/4/8/16 `d4-d8`, ext8/16/32 `c7-c9` | |
| object matched by an extension | ext | |
| other object with `toJSON()` | `toJSON()` result | e.g. a `Decimal` class; counts as one nesting level |
| function, symbol, other objects | throws `UNSUPPORTED_TYPE` | or omitted with `unsupported: 'ignore'` |

Symbol-keyed properties are not own string keys and are not encoded.

### Decoding

| Format | Result |
|---|---|
| fixint, uint8/16/32, int8/16/32 | `number` |
| uint64 / int64 | `bigint` (see `int64` option) |
| float32 `ca` / float64 `cb` | `number` |
| str | `string` (a leading U+FEFF is kept) |
| bin | `Uint8Array` (copy; view with `copyBinary: false`) |
| array | `Array` |
| map | plain object (own properties; `__proto__` defined as a data property) or `Map` with `mapAs: 'map'` |
| ext type −1 (Timestamp 32/64/96) | `Date` (millisecond precision; sub-ms nanoseconds are dropped) |
| other ext | extension `decode()` result, else `MsgpackExt` |
| `c1` | `INVALID_FORMAT` |

---

## Safety on Untrusted Input

What the decoder guarantees, whatever the bytes:

- It returns a value or throws `MsgpackDecodeError`. Nothing else escapes (fuzz test: 5000 random inputs).
- Memory is O(input size): a length header is checked against the remaining bytes before `new Array(len)` or any copy. The 6-byte input `dd 05 f5 e1 00 c0` (array of 100M) fails in ~0.1 ms. Before 0.2 it took up to 3.9 s and 2.4 GB on Bun.
- Recursion depth ≤ `maxDepth` (512): 100 KB of `0x91` fails with `MAX_DEPTH`, not a stack overflow.
- `__proto__` keys cannot change the prototype of decoded objects (on Deno the `__proto__` accessor is disabled anyway; on Bun and Node it was exploitable before 0.2).
- The decoder drops its reference to the input when it returns, so a large input is not kept alive.

For request bodies also set explicit limits, for example `new Decoder({ maxStrLength: 1 << 20, maxBinLength: 10 << 20, maxArrayLength: 100_000, maxMapLength: 10_000 })`, and cap the body size at the HTTP layer.

---

## Internal Details

### Encoder buffer

- Each encoder (the default one and each `new Encoder()`) owns `buf: Uint8Array`, `dv: DataView`, `pos`. It starts at 64 KB and doubles when needed.
- After each call, if `buf` grew beyond **1 MiB**, it is replaced with a new 64 KB buffer, so one large export does not pin memory for the life of the process.
- `encode` returns `buf.slice(0, pos)`; `encodeUnsafe` returns `buf.subarray(0, pos)`.
- **Re-entrancy**: a getter, `toJSON()` or extension `encode()` that calls the same encoder while it is encoding gets a fresh temporary encoder, so the outer result is not overwritten.
- `encodedSize` uses a separate lazily created scratch encoder with the same options.

### String encoding

- Fewer than 32 UTF-16 units: inline UTF-8 loop into a reserved `1 + 3·len` bytes, header written after (fixstr, or str8 with a one-byte shift when multi-byte characters pass 31 bytes).
- 32 units up to 2^20: `TextEncoder.encodeInto` directly into the buffer after reserving `3·len` bytes, then the header is fixed (shifting the data if the real length needs a smaller header).
- Longer: `TextEncoder.encode` then copy, to avoid reserving 3 bytes per unit for huge strings.
- Both paths produce the bytes `TextEncoder` produces.

### Decoder

- Each call sets `data`, a `DataView`, `pos`, `end`; `finally` clears them.
- **Key cache**: object keys that are fixstr of 1–16 bytes are hashed (`h = h·31 + byte`, 4096 slots) and compared byte for byte with the cached copy; a hit returns the same string, so V8/JSC do not re-intern it. A miss decodes and replaces the slot. Collisions only cost a miss. This is the main reason object decoding got 2.2–2.5x faster in 0.2.
- ASCII strings ≤ 24 bytes are built with `String.fromCharCode`; others go through `TextDecoder` (`ignoreBOM: true`, so a leading U+FEFF is kept; before 0.2 it was stripped).
- Nested decoding from an extension `decode()` runs on a fresh decoder.

### Encoding decision tree

```
value
  ├─ null / undefined              → nil
  ├─ boolean                       → c2 / c3
  ├─ number                        → integer (smallest, or float64/int64 beyond 32 bits) or float64
  ├─ string                        → fixstr / str8 / str16 / str32
  ├─ bigint                        → uint64 / int64 (range-checked)
  ├─ Array                         → array (depth + 1)
  ├─ Uint8Array                    → bin
  ├─ object, prototype Object/null → map (depth + 1)
  ├─ object matched by extension   → ext
  ├─ Date                          → ISO string | Timestamp
  ├─ MsgpackExt                    → ext
  ├─ Map                           → map (depth + 1)
  ├─ ArrayBuffer view / ArrayBuffer→ bin
  ├─ has toJSON()                  → encode(toJSON()) (depth + 1)
  ├─ plain object from other realm → map
  └─ anything else                 → MsgpackEncodeError UNSUPPORTED_TYPE (or omitted with 'ignore')
```

---

## Common Patterns

### HTTP response and request

```ts
import { decode, encode, MsgpackDecodeError } from "@coderbuzz/msgpack";

new Response(encode({ status: "ok", data }), { headers: { "Content-Type": "application/msgpack" } });

async function readBody(req: Request) {
  try {
    return decode(new Uint8Array(await req.arrayBuffer()));
  } catch (err) {
    if (err instanceof MsgpackDecodeError) throw new HttpError(400, "invalid msgpack body");
    throw err;
  }
}
```

### Deterministic bytes (hash chains, signatures, idempotency keys)

```ts
const canonical = new Encoder({ sortKeys: true, date: "timestamp", ignoreUndefined: true });
const digest = await crypto.subtle.digest("SHA-256", canonical.encode(journalEntry));
```

### Interop with Go, Rust, Python and other JS libraries

```ts
const enc = new Encoder({ date: "timestamp", largeInt: "int64" }); // typed decoders accept int64 fields
const dec = new Decoder({ int64: "auto" });                        // numbers stay numbers when they fit
```

### Batch into one buffer

```ts
function encodeBatch(items: unknown[]): Uint8Array {
  let total = 0;
  for (const item of items) total += encodedSize(item);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const item of items) offset += encodeInto(item, out, offset);
  return out; // read back with decodeMulti(out)
}
```

---

## Benchmarks

### Official (`github.com/coderbuzz/benchmarks`, `results/latest.json`)

2026-06-21, Apple Silicon, Bun 1.3.14, **@coderbuzz/msgpack 0.1.7** (before the 0.2 rewrite):

| Scenario | @coderbuzz/msgpack | @msgpack/msgpack | JSON |
|---|---|---|---|
| Nested object encode | 2.04M ops/s | 0.77M | 4.78M |
| Nested object decode | 0.90M ops/s | 0.87M | 1.96M |
| Wire size | 133 B | 133 B | 178 B |

The suite compares only with `@msgpack/msgpack`'s top-level `encode()`/`decode()`, not with a reused `Encoder` or with msgpackr. On Bun 1.4.2 the "2.7x faster encode" of 0.1.7 no longer reproduces (1.09x against a reused `@msgpack/msgpack` `Encoder`), which is why DOCS no longer claims it.

### Local, this release (not the official source)

Bun 1.4.2, Linux x64 container, mitata, average per operation. msgpackr 2.1.0 (`useRecords: false`), @msgpack/msgpack 3.1.3, notepack.io 3.0.1. Container noise is about ±25%.

| Payload | encode | msgpackr | @msgpack `Encoder` | decode | msgpackr | @msgpack `decode()` | notepack |
|---|---|---|---|---|---|---|---|
| nested (133 B) | 0.97 µs | 1.07 µs | 1.18 µs | 1.39 µs | 1.83 µs | 1.70 µs | 1.57 µs |
| small `{ok, id}` | 140 ns | 155 ns | 161 ns | 118 ns | 88 ns | 208 ns | 145 ns |
| rows (100 invoices, 15.8 KB) | 74.9 µs | 77.5 µs | 84.1 µs | 98.4 µs | 109.4 µs | 155.2 µs | 83.6 µs |
| long string 2.3 KB | 0.87 µs | 0.66 µs | 4.36 µs | 0.86 µs | 1.01 µs | 0.87 µs | 0.79 µs |
| unicode | 700 ns | 619 ns | 938 ns | 718 ns | 1.32 µs | 2.01 µs | 715 ns |
| 1000 integers | 11.2 µs | 18.0 µs | 17.1 µs | 9.75 µs | 8.74 µs | 10.6 µs | 8.37 µs |
| 1000 floats | 14.9 µs | 31.4 µs | 29.1 µs | 10.9 µs | 9.73 µs | 10.9 µs | 8.35 µs |
| 64 KB bin | 7.48 µs | 9.25 µs | 7.91 µs | 5.39 µs² | 0.42 µs | 0.29 µs | 0.17 µs |

² bin is copied by default; `copyBinary: false` decodes it in 0.17 µs. `encodeUnsafe` skips the result copy (2.03 µs for 64 KB bin, 0.22 µs for the long string).

Change from 0.1.21 on the same machine (old / new): decode nested 2.21x, small 2.47x, rows 2.48x faster (key cache); encode long strings 1.5–3.2x (in-place UTF-8), rows 1.92x, integers 1.71x, floats 1.68x faster. Decoding long strings is 0.83–1.10x (within noise; the bounds checks cost a few percent).

Bundle: 7.9 KB gzip unminified, 5.9 KB gzip minified (0.1.21: 2.8 / 1.9 KB). For comparison, minified: @msgpack/msgpack 6.3 KB, msgpackr 11.0 KB.

---

## Edge Cases & Rules

| Scenario | Behavior |
|---|---|
| `undefined` → encode → decode | `null` (or omitted key with `ignoreUndefined`) |
| `-0`, `NaN`, `±Infinity` | preserved |
| `Number.MAX_SAFE_INTEGER + 2` | float64, the nearest double (JS already lost precision); use `bigint` |
| Unpaired surrogate `"\uD83D" + "abc"` | `"�abc"`, never swallows the next character |
| Leading U+FEFF | preserved |
| Circular reference | `MAX_DEPTH` at the 513th level |
| `toJSON()` returning `this` | `MAX_DEPTH` |
| Getter that calls `encode()` | works (fresh temporary encoder) |
| `{ toJSON() {...} }` as a **plain** object | the `toJSON` function is a value → `UNSUPPORTED_TYPE` (toJSON is honored only for non-plain objects) |
| Class instance without `toJSON` | `UNSUPPORTED_TYPE`; give it `toJSON()` or spread it (`{ ...obj }`) |
| `Set` | `UNSUPPORTED_TYPE`; encode `[...set]` |
| Map key `1` and `"1"` in the same map (`mapAs: 'object'`) | last wins, as in JavaScript objects |
| Duplicate keys | last wins |
| Truncated input | `TRUNCATED`, never a shorter string or bin |
| Two messages in one buffer with `decode()` | `TRAILING_BYTES`; use `decodeMulti` or `decodeAt` |
| Very large array header (> 2^32) | impossible in msgpack (32-bit lengths) |

---

## Changes in 0.2 (breaking)

| Before (0.1.x) | Now |
|---|---|
| function / symbol written as 0 bytes (corrupt stream) | `MsgpackEncodeError` `UNSUPPORTED_TYPE` |
| `Map`, `Set`, class instances → map of own keys (`Map` → `{}`) | `Map` → map; typed arrays / `ArrayBuffer` → bin; objects with `toJSON` → its result; others throw |
| bigint wrapped modulo 2^64 | `BIGINT_RANGE` |
| truncated str/bin returned short or NUL-padded | `TRUNCATED` |
| trailing bytes ignored | `TRAILING_BYTES` (use `decodeMulti` / `decodeAt`) |
| non-string map keys stringified (`"[object Object]"`) | numbers stringified; others `INVALID_KEY` |
| `__proto__` key replaced the prototype | own data property |
| float32, ext, Timestamp threw | decoded (`number`, `MsgpackExt` / extension, `Date`) |
| malformed input: `TypeError`/`RangeError` from the runtime | `MsgpackDecodeError` with `code` and `offset` |
| no depth limit (stack overflow) | `maxDepth` 512 for encode and decode |
| `encodedSize(fn)` = 1 | throws, like `encode` |
| leading U+FEFF stripped | preserved |
