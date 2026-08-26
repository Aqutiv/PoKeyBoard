import { describe, expect, it } from 'vitest';
import { noteHand } from '@/domain/hands';

describe('noteHand', () => {
  it('follows the staff a score wrote the note on', () => {
    // A left-hand passage written high still belongs to the left hand.
    expect(noteHand({ midi: 76, staff: 'bass' })).toBe('left');
    expect(noteHand({ midi: 43, staff: 'treble' })).toBe('right');
  });

  it('splits at middle C when the take says nothing', () => {
    expect(noteHand({ midi: 60 })).toBe('right');
    expect(noteHand({ midi: 59 })).toBe('left');
  });
});
