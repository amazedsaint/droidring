import { describe, expect, it } from 'vitest';
import { randomKey } from '../src/p2p/crypto.js';
import { decodeTicket, encodeTicket } from '../src/p2p/ticket.js';

describe('ticket', () => {
  it('roundtrips', () => {
    const rootSecret = randomKey();
    const bootstrap = [randomKey(), randomKey()];
    const ticket = encodeTicket({ roomName: '#general', rootSecret, bootstrapPubkeys: bootstrap });
    const decoded = decodeTicket(ticket);
    expect(decoded.roomName).toBe('#general');
    expect(Buffer.from(decoded.rootSecret).equals(Buffer.from(rootSecret))).toBe(true);
    expect(decoded.bootstrapPubkeys.length).toBe(2);
    expect(Buffer.from(decoded.bootstrapPubkeys[0]).equals(Buffer.from(bootstrap[0]))).toBe(true);
  });

  it('rejects garbage', () => {
    expect(() => decodeTicket('not-a-ticket!!!')).toThrow();
  });

  it('survives empty bootstrap list', () => {
    const rootSecret = randomKey();
    const t = encodeTicket({ roomName: 'r', rootSecret, bootstrapPubkeys: [] });
    const d = decodeTicket(t);
    expect(d.bootstrapPubkeys.length).toBe(0);
    expect(d.roomName).toBe('r');
  });
});
