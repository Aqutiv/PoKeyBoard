import { describe, expect, it } from 'vitest';
import { BleMidiParser, bleMidiSysExPackets } from '@/features/keyboard/bleMidiCodec';

/** One packet through `parser`, its messages as plain byte arrays. */
function parse(parser: BleMidiParser, ...bytes: number[]) {
  const packet = parser.parse(Uint8Array.from(bytes));
  return {
    ok: packet.ok,
    messages: packet.messages.map((m) => ({ data: [...m.data], timestamp: m.timestamp })),
    sysex: packet.sysex.map((s) => [...s]),
  };
}

describe('BleMidiParser', () => {
  // The vectors are PianoBallDesktop's (tests/BleMidiTests.cpp), run in the
  // same order on one parser, since running status carries between them.
  it('decodes channel messages, timestamps and running status', () => {
    const p = new BleMidiParser();

    let r = parse(p, 0x81, 0x85, 0x90, 60, 100);
    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([{ data: [0x90, 60, 100], timestamp: (1 << 7) | 5 }]);

    r = parse(p, 0x80, 0x80, 0x90, 60, 100, 0x82, 0x80, 60, 0);
    expect(r.ok).toBe(true);
    expect(r.messages[1]).toEqual({ data: [0x80, 60, 0], timestamp: 2 });

    r = parse(p, 0x80, 0x81, 0x90, 60, 100, 62, 90, 64, 80);
    expect(r.messages).toHaveLength(3);
    expect(r.messages[2]).toEqual({ data: [0x90, 64, 80], timestamp: 1 });

    r = parse(p, 0x80, 0x81, 0x90, 60, 100, 0x83, 67, 70);
    expect(r.messages[1]).toEqual({ data: [0x90, 67, 70], timestamp: 3 });

    // Running status carries across notifications: 0xa0 here is a timestamp.
    r = parse(p, 0x80, 0xa0, 48, 40);
    expect(r.ok).toBe(true);
    expect(r.messages.map((m) => m.data)).toEqual([[0x90, 48, 40]]);

    r = parse(p, 0x80, 0x81, 0xc2, 5, 6);
    expect(r.messages.map((m) => m.data)).toEqual([
      [0xc2, 5],
      [0xc2, 6],
    ]);

    r = parse(p, 0x80, 0x81, 0xe0, 0, 64, 0x82, 0xd0, 90);
    expect(r.messages.map((m) => m.data)).toEqual([
      [0xe0, 0, 64],
      [0xd0, 90],
    ]);
  });

  it('wraps the low byte into the high bits, and the 13-bit clock', () => {
    const p = new BleMidiParser();
    const r = parse(p, 0xbf, 0xfe, 0x90, 60, 100, 0x81, 0x80, 60, 0);
    expect(r.messages.map((m) => m.timestamp)).toEqual([8190, 1]);
  });

  it('drops real-time bytes and keeps running status across them', () => {
    const p = new BleMidiParser();
    let r = parse(p, 0x80, 0x81, 0xf8, 0x81, 0x90, 60, 1);
    expect(r.ok).toBe(true);
    expect(r.messages.map((m) => m.data)).toEqual([[0x90, 60, 1]]);

    r = parse(p, 0x80, 0x81, 0x90, 60, 100, 0x82, 0xfe, 61, 90);
    expect(r.messages.map((m) => m.data)).toEqual([
      [0x90, 60, 100],
      [0x90, 61, 90],
    ]);
  });

  it('reassembles SysEx across notifications, with real-time inside it', () => {
    const p = new BleMidiParser();
    let r = parse(p, 0x80, 0x81, 0xf0, 0x41, 0x10, 0x42, 0x82, 0xf7, 0x83, 0x91, 60, 100);
    expect(r.messages.map((m) => m.data)).toEqual([[0x91, 60, 100]]);
    expect(r.sysex).toEqual([[0xf0, 0x41, 0x10, 0x42, 0xf7]]);

    r = parse(p, 0x80, 0x81, 0xf0, 1, 2, 3);
    expect(r.ok).toBe(true);
    expect(r.messages).toEqual([]);
    r = parse(p, 0x80, 4, 5, 6, 0x81, 0xf8, 7, 8);
    expect(r.ok).toBe(true);
    expect(r.sysex).toEqual([]);
    r = parse(p, 0x80, 9, 0x82, 0xf7, 0x83, 0x92, 60, 100);
    expect(r.ok).toBe(true);
    expect(r.sysex).toEqual([[0xf0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xf7]]);
    expect(r.messages.map((m) => m.data)).toEqual([[0x92, 60, 100]]);
  });

  it('consumes System Common, which keeps running status; SysEx cancels it', () => {
    const p = new BleMidiParser();
    let r = parse(p, 0x80, 0x81, 0xf2, 1, 2, 0x82, 0x93, 60, 1);
    expect(r.messages.map((m) => m.data)).toEqual([[0x93, 60, 1]]);

    r = parse(p, 0x80, 0x81, 0x90, 0x3c, 0x64, 0x82, 0xf1, 0x00, 0x83, 0x3c, 0x00);
    expect(r.ok).toBe(true);
    expect(r.messages[1]?.data).toEqual([0x90, 0x3c, 0]);

    r = parse(p, 0x80, 0x81, 0x91, 60, 1, 0x82, 0xf6, 61, 2);
    expect(r.messages[1]).toEqual({ data: [0x91, 61, 2], timestamp: 2 });

    r = parse(p, 0x80, 0x81, 0x90, 60, 1, 0x82, 0xf0, 1, 0x83, 0xf7, 0x84, 61, 1);
    expect(r.ok).toBe(false);
    expect(r.messages).toHaveLength(1);
  });

  it('rejects malformed packets, keeping what decoded before the fault', () => {
    const p = new BleMidiParser();
    expect(parse(p, 0x80, 0x81, 0x90, 60)).toMatchObject({ ok: false, messages: [] });
    expect(parse(p, 0x80, 0x81)).toMatchObject({ ok: false, messages: [] });
    expect(parse(p, 0x80, 0x81, 0x90, 60, 0x90)).toMatchObject({ ok: false, messages: [] });
    const cut = parse(p, 0x80, 0x81, 0x90, 60, 100, 0x82, 0x90, 61);
    expect(cut.ok).toBe(false);
    expect(cut.messages).toHaveLength(1);
    expect(parse(p, 0x40, 0x81, 0x90, 60, 100)).toMatchObject({ ok: false, messages: [] });
    expect(parse(p, 0x80)).toMatchObject({ ok: false, messages: [] });
    expect(new BleMidiParser().parse(new Uint8Array()).ok).toBe(false);

    p.reset();
    expect(parse(p, 0x80, 0x81, 60, 100)).toMatchObject({ ok: false, messages: [] });
  });

  it('keeps a PartyKeys SysEx whole, and the note after it still plays', () => {
    const p = new BleMidiParser();
    const one = parse(
      p,
      ...[0x80, 0x81, 0xf0, 0x05, 0x30, 0x20, 0x00, 0x00, 0x3f, 0x18, 0x01, 0x00],
      ...[0x82, 0xf7, 0x83, 0x90, 60, 100],
    );
    expect(one.ok).toBe(true);
    expect(one.sysex).toEqual([[0xf0, 0x05, 0x30, 0x20, 0x00, 0x00, 0x3f, 0x18, 0x01, 0x00, 0xf7]]);
    expect(one.messages.map((m) => m.data)).toEqual([[0x90, 60, 100]]);

    expect(parse(p, 0x80, 0x81, 0xf0, 0x05, 0x30, 0x20).sysex).toEqual([]);
    const second = parse(p, 0x80, 0x00, 0x00, 0x3f, 0x18, 0x7f, 0x00, 0x82, 0xf7);
    expect(second.ok).toBe(true);
    expect(second.sysex).toEqual([
      [0xf0, 0x05, 0x30, 0x20, 0x00, 0x00, 0x3f, 0x18, 0x7f, 0x00, 0xf7],
    ]);

    const cut = parse(p, 0x80, 0x81, 0xf0, 0x05, 0x30, 0x82, 0x90, 60, 100);
    expect(cut.sysex).toEqual([]);
    expect(cut.messages).toHaveLength(1);

    const long = [0x80, 0x81, 0xf0, ...Array.from({ length: 80 }, () => 1), 0x82, 0xf7];
    const dropped = parse(p, ...long);
    expect(dropped.ok).toBe(true);
    expect(dropped.sysex).toEqual([]);
  });
});

describe('bleMidiSysExPackets', () => {
  const MODE = Uint8Array.of(0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00, 0x0f, 0x01, 0xf7);

  it('frames a short SysEx as one packet: header, timestamp, F0 … timestamp, F7', () => {
    const packets = bleMidiSysExPackets(MODE, 20, (3 << 7) | 9);
    expect(packets.map((p) => [...p])).toEqual([
      [0x83, 0x89, 0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00, 0x0f, 0x01, 0x89, 0xf7],
    ]);
  });

  it('splits a 90-byte frame into five 20-byte packets that carry the body in order', () => {
    const frame = Uint8Array.from([0xf0, ...Array.from({ length: 88 }, (_, i) => i), 0xf7]);
    const split = bleMidiSysExPackets(frame, 20, 5);
    expect(split).toHaveLength(5);
    const body: number[] = [];
    split.forEach((packet, i) => {
      expect(packet.length).toBeLessThanOrEqual(20);
      expect(packet[0]).toBe(0x80);
      const from = i === 0 ? 3 : 1;
      const to = i + 1 === split.length ? packet.length - 2 : packet.length;
      body.push(...packet.slice(from, to));
    });
    expect(split[0]?.[2]).toBe(0xf0);
    const last = split[split.length - 1] as Uint8Array;
    expect([...last.slice(-2)]).toEqual([0x85, 0xf7]);
    expect(body).toEqual([...frame.slice(1, -1)]);

    expect(bleMidiSysExPackets(frame, 185, 5)).toHaveLength(1);
  });

  it('frames only SysEx', () => {
    expect(bleMidiSysExPackets(Uint8Array.of(0x90, 60, 100))).toEqual([]);
    expect(bleMidiSysExPackets(Uint8Array.of(0xf0, 0x90, 0xf7))).toEqual([]);
  });

  it('decodes back to the message it framed', () => {
    const back = new BleMidiParser();
    const again: number[][] = [];
    for (const packet of bleMidiSysExPackets(MODE, 8, 1)) {
      again.push(...back.parse(packet).sysex.map((s) => [...s]));
    }
    expect(again).toEqual([[...MODE]]);
  });
});
