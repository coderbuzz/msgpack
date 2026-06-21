import { test, expect } from "bun:test";
import { encode, decode, encodedSize } from "../src/index";

test("encode/decode string", () => {
  const buf = encode("hello");
  expect(decode(buf)).toBe("hello");
});

test("encode/decode object", () => {
  const val = { a: 1, b: "x", c: [1, 2] };
  expect(decode(encode(val))).toEqual(val);
});

test("encodedSize matches", () => {
  const val = { name: "test", count: 42 };
  expect(encodedSize(val)).toBe(encode(val).length);
});